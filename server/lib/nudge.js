import { query } from './db.js'
import { getTalentRecommendations } from './graph.js'
import { trackEvent } from './posthog.js'
import { loadTemplate, applyVariables, emailLayout, sendEmail, isUnsubscribed, getRecipient } from './email.js'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

let nudgeRunning = false

/**
 * Process nudge emails for dormant vouch invitees.
 *
 * Finds pending vouch_invites where the invitee hasn't vouched, checks timing
 * and network size thresholds, then sends nudge_1 or nudge_2 as appropriate.
 *
 * @returns {{ nudge_1_sent: number, nudge_2_sent: number, skipped: number, errors: Array }}
 */
export async function processNudges() {
  if (nudgeRunning) {
    console.log('[Nudge] Already running, skipping')
    return { nudge_1_sent: 0, nudge_2_sent: 0, skipped: 0, errors: [{ error: 'Already running' }] }
  }

  nudgeRunning = true
  const results = { nudge_1_sent: 0, nudge_2_sent: 0, skipped: 0, errors: [] }

  try {
    // 1. Load nudge settings
    const settingsRes = await query(
      `SELECT key, value FROM app_settings WHERE key IN (
        'nudge_1_delay_days', 'nudge_2_delay_days', 'nudge_network_threshold'
      )`
    )
    const settings = {}
    for (const row of settingsRes.rows) settings[row.key] = Number(row.value)

    const nudge1Days = settings.nudge_1_delay_days ?? 5
    const nudge2Days = settings.nudge_2_delay_days ?? 12
    const networkThreshold = settings.nudge_network_threshold ?? 5

    // 2. Load scoring settings for network size computation
    const scoringRes = await query(
      `SELECT key, value FROM app_settings WHERE key IN ('cross_function_discount', 'sibling_coefficient')`
    )
    const scoring = {}
    for (const row of scoringRes.rows) scoring[row.key] = Number(row.value)
    const crossFunctionDiscount = scoring.cross_function_discount ?? 0.5
    const siblingCoefficient = scoring.sibling_coefficient ?? 0.8

    // 3. Find eligible pending invites
    //    - status = pending, not self-invite, invitee has email, not unsubscribed
    //    - invitee has NOT already vouched (not an active user)
    //    - old enough for at least nudge_1
    //    - dedup: checks if this PERSON has ever received nudge_1/nudge_2 (any invite)
    const eligibleRes = await query(`
      SELECT
        vi.id AS invite_id,
        vi.token,
        vi.inviter_id,
        vi.invitee_id,
        vi.job_function_id,
        vi.created_at,
        FLOOR(EXTRACT(EPOCH FROM (NOW() - vi.created_at)) / 86400.0) AS days_since_invite,
        p_invitee.display_name AS invitee_name,
        p_invitee.email AS invitee_email,
        p_inviter.display_name AS inviter_name,
        jf.name AS jf_name,
        jf.practitioner_label AS jf_practitioner_label,
        (SELECT COUNT(*) FROM sent_emails se
         WHERE se.recipient_id = vi.invitee_id
           AND se.email_type = 'nudge_1') AS nudge_1_sent_count,
        (SELECT COUNT(*) FROM sent_emails se
         WHERE se.recipient_id = vi.invitee_id
           AND se.email_type = 'nudge_2') AS nudge_2_sent_count
      FROM vouch_invites vi
      JOIN people p_invitee ON p_invitee.id = vi.invitee_id
      JOIN people p_inviter ON p_inviter.id = vi.inviter_id
      JOIN job_functions jf ON jf.id = vi.job_function_id
      WHERE vi.status = 'pending'
        AND vi.inviter_id != vi.invitee_id
        AND p_invitee.email IS NOT NULL
        AND p_invitee.unsubscribed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM vouches WHERE voucher_id = vi.invitee_id)
        AND EXTRACT(EPOCH FROM (NOW() - vi.created_at)) / 86400.0 >= $1
      ORDER BY vi.created_at ASC
    `, [nudge1Days])

    // 4. Cache network sizes per inviter, and function-specific rec counts
    const networkSizeCache = new Map()
    const recCountCache = new Map() // key: `${inviterId}:${jobFunctionId}`

    async function getNetworkSize(inviterId) {
      if (networkSizeCache.has(inviterId)) return networkSizeCache.get(inviterId)
      try {
        const recs = await getTalentRecommendations(inviterId, null, {
          crossFunctionDiscount,
          siblingCoefficient,
        })
        const size = recs.length
        networkSizeCache.set(inviterId, size)
        return size
      } catch (err) {
        console.error(`[Nudge] Failed to get network size for inviter ${inviterId}:`, err.message)
        networkSizeCache.set(inviterId, 0)
        return 0
      }
    }

    async function getRecCount(inviterId, jobFunctionId) {
      const key = `${inviterId}:${jobFunctionId}`
      if (recCountCache.has(key)) return recCountCache.get(key)
      try {
        const recs = await getTalentRecommendations(inviterId, jobFunctionId, {
          crossFunctionDiscount,
          siblingCoefficient,
        })
        const count = recs.length
        recCountCache.set(key, count)
        return count
      } catch (err) {
        console.error(`[Nudge] Failed to get rec count for inviter ${inviterId}, fn ${jobFunctionId}:`, err.message)
        recCountCache.set(key, 0)
        return 0
      }
    }

    // 5. Group eligible invites by invitee — each person gets at most one nudge.
    //    For each invitee, determine the nudge type, then pick the invite whose
    //    inviter has the largest network (best social proof).
    const inviteeGroups = new Map() // invitee_id -> { nudgeType, rows: [...] }

    for (const row of eligibleRes.rows) {
      const nudge1AlreadySent = Number(row.nudge_1_sent_count) > 0
      const nudge2AlreadySent = Number(row.nudge_2_sent_count) > 0
      const daysSince = Number(row.days_since_invite)

      let nudgeType = null
      if (daysSince >= nudge2Days && nudge1AlreadySent && !nudge2AlreadySent) {
        nudgeType = 'nudge_2'
      } else if (!nudge1AlreadySent) {
        nudgeType = 'nudge_1'
      }

      if (!nudgeType) {
        results.skipped++
        continue
      }

      const existing = inviteeGroups.get(row.invitee_id)
      if (!existing) {
        inviteeGroups.set(row.invitee_id, { nudgeType, rows: [row] })
      } else if (existing.nudgeType === nudgeType) {
        // Same nudge type — add row as candidate (will pick best inviter later)
        existing.rows.push(row)
      } else {
        // Different nudge type across invites for same person — skip the lower one
        results.skipped++
      }
    }

    // 6. For each invitee, pick the invite with the largest inviter network and send
    for (const [inviteeId, { nudgeType, rows }] of inviteeGroups) {
      try {
        // Resolve network sizes for all candidate inviters, pick the largest
        let bestRow = null
        let bestNetworkSize = -1
        for (const row of rows) {
          const networkSize = await getNetworkSize(row.inviter_id)
          if (networkSize > bestNetworkSize) {
            bestNetworkSize = networkSize
            bestRow = row
          }
        }

        if (bestNetworkSize < networkThreshold) {
          results.skipped++
          continue
        }

        // Check daily email cap (3 per 24hrs)
        const capRes = await query(
          `SELECT COUNT(*) AS cnt FROM sent_emails
           WHERE recipient_id = $1 AND sent_at > NOW() - INTERVAL '24 hours'`,
          [inviteeId]
        )
        if (Number(capRes.rows[0].cnt) >= 3) {
          results.skipped++
          continue
        }

        // Build template variables using the best inviter's invite
        const row = bestRow
        const daysSince = Number(row.days_since_invite)
        const firstName = row.invitee_name.split(' ')[0]
        const inviterFirstName = row.inviter_name.split(' ')[0]
        const practitionerLabel = row.jf_practitioner_label || row.jf_name
        const vouchUrl = `${BASE_URL}/vouch?token=${row.token}`
        const recommendationCount = await getRecCount(row.inviter_id, row.job_function_id)

        const vars = {
          firstName,
          inviterFirstName,
          inviterFullName: row.inviter_name,
          jobFunction: row.jf_name,
          jobFunctionShort: practitionerLabel,
          practitionerLabel,
          vouchUrl,
          networkSize: String(bestNetworkSize),
          recommendationCount: String(recommendationCount),
          daysSinceInvite: String(daysSince),
        }

        // Load template, apply vars, send
        const template = await loadTemplate(nudgeType)
        const subject = applyVariables(template.subject, vars)
        const bodyHtml = applyVariables(template.body_html, vars)
        const html = emailLayout(bodyHtml, row.invitee_id)
        const recipient = await getRecipient(row.invitee_email)

        const resendId = await sendEmail({
          to: recipient,
          subject,
          html,
          personId: row.invitee_id,
          templateKey: nudgeType,
        })

        // Record in sent_emails (unique index prevents duplicates per recipient)
        await query(
          `INSERT INTO sent_emails (recipient_id, email_type, reference_id, resend_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [row.invitee_id, nudgeType, row.invite_id, resendId]
        )

        console.log(`[Nudge] Sent ${nudgeType} to ${row.invitee_name} via ${row.inviter_name} (invite ${row.invite_id}, network=${bestNetworkSize})`)
        trackEvent(String(row.invitee_id), 'nudge_sent', {
          nudge_type: nudgeType,
          invite_id: row.invite_id,
          inviter_id: row.inviter_id,
          network_size: bestNetworkSize,
          days_since_invite: daysSince,
        })

        if (nudgeType === 'nudge_1') results.nudge_1_sent++
        else results.nudge_2_sent++

      } catch (err) {
        console.error(`[Nudge] Error processing nudge for invitee ${inviteeId}:`, err.message)
        results.errors.push({ invitee_id: inviteeId, error: err.message })
      }
    }
  } catch (err) {
    console.error('[Nudge] Fatal error in processNudges:', err.message)
    results.errors.push({ error: err.message })
  } finally {
    nudgeRunning = false
  }

  return results
}

/**
 * Process voucher nudge emails — remind vouchers to personally nudge their
 * picks who haven't responded yet.
 *
 * For each voucher+function combo where at least one invitee is still pending
 * after N days, sends a single email with the status of each pick (completed
 * or pending) and the pending invitees' vouch URLs + mailto: links.
 *
 * One voucher_nudge per voucher per job function, ever.
 *
 * @returns {{ sent: number, skipped: number, errors: Array }}
 */
export async function processVoucherNudges() {
  const results = { sent: 0, skipped: 0, errors: [] }

  try {
    // 1. Load delay setting
    const settingsRes = await query(
      `SELECT value FROM app_settings WHERE key = 'voucher_nudge_delay_days'`
    )
    const delayDays = Number(settingsRes.rows[0]?.value) || 7

    // 2. Find vouchers with at least one pending invitee past the delay threshold,
    //    who haven't already received a voucher_nudge for that function.
    //    Groups by voucher + job function.
    const vouchersRes = await query(`
      SELECT
        vi.inviter_id,
        vi.job_function_id,
        p.display_name AS voucher_name,
        p.email AS voucher_email,
        jf.name AS jf_name,
        jf.practitioner_label,
        MIN(vi.created_at) AS earliest_invite
      FROM vouch_invites vi
      JOIN people p ON p.id = vi.inviter_id
      JOIN job_functions jf ON jf.id = vi.job_function_id
      WHERE vi.inviter_id != vi.invitee_id
        AND p.email IS NOT NULL
        AND p.unsubscribed_at IS NULL
        -- At least one pending invitee old enough
        AND EXISTS (
          SELECT 1 FROM vouch_invites vi2
          WHERE vi2.inviter_id = vi.inviter_id
            AND vi2.job_function_id = vi.job_function_id
            AND vi2.inviter_id != vi2.invitee_id
            AND vi2.status = 'pending'
            AND EXTRACT(EPOCH FROM (NOW() - vi2.created_at)) / 86400.0 >= $1
        )
        -- Haven't already received voucher_nudge for this function
        AND NOT EXISTS (
          SELECT 1 FROM sent_emails se
          WHERE se.recipient_id = vi.inviter_id
            AND se.email_type = 'voucher_nudge'
            AND se.reference_id = vi.job_function_id
        )
      GROUP BY vi.inviter_id, vi.job_function_id, p.display_name, p.email, jf.name, jf.practitioner_label
      ORDER BY earliest_invite ASC
    `, [delayDays])

    // 3. For each voucher+function, get all their invitees and build the status email
    for (const voucher of vouchersRes.rows) {
      try {
        // Check daily email cap
        const capRes = await query(
          `SELECT COUNT(*) AS cnt FROM sent_emails
           WHERE recipient_id = $1 AND sent_at > NOW() - INTERVAL '24 hours'`,
          [voucher.inviter_id]
        )
        if (Number(capRes.rows[0].cnt) >= 3) {
          results.skipped++
          continue
        }

        // Get all invitees for this voucher + function
        const inviteesRes = await query(`
          SELECT
            vi.id AS invite_id,
            vi.token,
            vi.status,
            vi.invitee_id,
            p.display_name AS invitee_name,
            p.email AS invitee_email
          FROM vouch_invites vi
          JOIN people p ON p.id = vi.invitee_id
          WHERE vi.inviter_id = $1
            AND vi.job_function_id = $2
            AND vi.inviter_id != vi.invitee_id
          ORDER BY vi.created_at ASC
        `, [voucher.inviter_id, voucher.job_function_id])

        const invitees = inviteesRes.rows
        const pending = invitees.filter(i => i.status === 'pending')
        const completed = invitees.filter(i => i.status === 'completed')

        if (pending.length === 0) {
          results.skipped++
          continue
        }

        // Build invitee status HTML
        const statusRows = invitees.map(inv => {
          if (inv.status === 'completed') {
            return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #F3F4F6;">
              <span style="font-size:18px;">✅</span>
              <div>
                <div style="font-size:14px;font-weight:600;color:#1C1917;">${inv.invitee_name}</div>
                <div style="font-size:12px;color:#16A34A;">Completed</div>
              </div>
            </div>`
          }

          const vouchUrl = `${BASE_URL}/vouch?token=${inv.token}`
          const inviteeFirst = inv.invitee_name.split(' ')[0]
          const mailtoSubject = encodeURIComponent(`Quick favor — VouchFour`)
          const mailtoBody = encodeURIComponent(
            `Hey ${inviteeFirst},\n\nI vouched for you on VouchFour as one of the best people I've worked with. It only takes a couple minutes — would mean a lot if you could share your picks too:\n\n${vouchUrl}\n\nThanks!`
          )
          const mailtoLink = `mailto:${inv.invitee_email}?subject=${mailtoSubject}&body=${mailtoBody}`

          return `<div style="padding:10px 0;border-bottom:1px solid #F3F4F6;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:18px;">⏳</span>
              <div>
                <div style="font-size:14px;font-weight:600;color:#1C1917;">${inv.invitee_name}</div>
                <div style="font-size:12px;color:#D97706;">Waiting on response</div>
              </div>
            </div>
            <div style="margin:8px 0 0 28px;">
              <a href="${mailtoLink}" style="display:inline-block;padding:6px 14px;background:#2563EB;color:#FFFFFF;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;">Email ${inviteeFirst} a reminder</a>
              <div style="margin-top:6px;font-size:11px;color:#9CA3AF;word-break:break-all;">
                Or text them this link: ${vouchUrl}
              </div>
            </div>
          </div>`
        })

        const inviteeStatusHtml = `<div style="border:1px solid #E5E7EB;border-radius:10px;padding:4px 14px;background:#FAFAF9;">${statusRows.join('')}</div>`

        // Build template variables
        const firstName = voucher.voucher_name.split(' ')[0]
        const practitionerLabel = voucher.practitioner_label || voucher.jf_name

        const vars = {
          firstName,
          fullName: voucher.voucher_name,
          practitionerLabel,
          jobFunction: voucher.jf_name,
          pendingCount: String(pending.length),
          totalCount: String(invitees.length),
          completedCount: String(completed.length),
          inviteeStatusHtml,
        }

        // Load template, apply vars, send
        const template = await loadTemplate('voucher_nudge')
        const subject = applyVariables(template.subject, vars)
        const bodyHtml = applyVariables(template.body_html, vars)
        const html = emailLayout(bodyHtml, voucher.inviter_id)
        const recipient = await getRecipient(voucher.voucher_email)

        const resendId = await sendEmail({
          to: recipient,
          subject,
          html,
          personId: voucher.inviter_id,
          templateKey: 'voucher_nudge',
        })

        // Record — reference_id = job_function_id for per-function dedup
        await query(
          `INSERT INTO sent_emails (recipient_id, email_type, reference_id, resend_id)
           VALUES ($1, 'voucher_nudge', $2, $3)
           ON CONFLICT DO NOTHING`,
          [voucher.inviter_id, voucher.job_function_id, resendId]
        )

        console.log(`[VoucherNudge] Sent to ${voucher.voucher_name} for ${practitionerLabel} (${pending.length}/${invitees.length} pending)`)
        trackEvent(String(voucher.inviter_id), 'voucher_nudge_sent', {
          job_function: voucher.jf_name,
          pending_count: pending.length,
          total_count: invitees.length,
        })

        results.sent++
      } catch (err) {
        console.error(`[VoucherNudge] Error for inviter ${voucher.inviter_id}:`, err.message)
        results.errors.push({ inviter_id: voucher.inviter_id, error: err.message })
      }
    }
  } catch (err) {
    console.error('[VoucherNudge] Fatal error:', err.message)
    results.errors.push({ error: err.message })
  }

  return results
}
