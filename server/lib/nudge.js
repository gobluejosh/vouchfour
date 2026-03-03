import crypto from 'node:crypto'
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
 * Sends one batched email per voucher with:
 *   - A network CTA (login token link to their talent page)
 *   - Status of each pick (completed or pending), grouped by function
 *   - Gmail-aware compose links (Gmail compose URL or mailto:) for pending picks
 *   - Raw vouch URL for copy/paste texting
 *
 * One voucher_nudge per person, ever.
 *
 * @returns {{ sent: number, skipped: number, errors: Array }}
 */
export async function processVoucherNudges() {
  const results = { sent: 0, skipped: 0, errors: [] }

  try {
    // 1. Load settings
    const settingsRes = await query(
      `SELECT key, value FROM app_settings WHERE key IN (
        'voucher_nudge_delay_days', 'cross_function_discount', 'sibling_coefficient'
      )`
    )
    const settings = {}
    for (const row of settingsRes.rows) settings[row.key] = row.value
    const delayDays = Number(settings.voucher_nudge_delay_days) || 7
    const crossFunctionDiscount = Number(settings.cross_function_discount) ?? 0.5
    const siblingCoefficient = Number(settings.sibling_coefficient) ?? 0.8

    // 2. Find vouchers who have at least one pending invitee past the delay,
    //    and haven't already received a voucher_nudge (one per person, ever).
    const vouchersRes = await query(`
      SELECT DISTINCT
        vi.inviter_id,
        p.display_name AS voucher_name,
        p.email AS voucher_email,
        p.linkedin_url AS voucher_linkedin_url,
        (SELECT split_part(p2.display_name, ' ', 1)
         FROM vouch_invites vi2
         JOIN people p2 ON p2.id = vi2.inviter_id
         WHERE vi2.invitee_id = vi.inviter_id
           AND vi2.inviter_id != vi2.invitee_id
         ORDER BY vi2.created_at ASC
         LIMIT 1) AS vouched_by_first_name
      FROM vouch_invites vi
      JOIN people p ON p.id = vi.inviter_id
      WHERE vi.inviter_id != vi.invitee_id
        AND p.email IS NOT NULL
        AND p.unsubscribed_at IS NULL
        AND vi.status = 'pending'
        AND EXTRACT(EPOCH FROM (NOW() - vi.created_at)) / 86400.0 >= $1
        -- Haven't already received a voucher_nudge
        AND NOT EXISTS (
          SELECT 1 FROM sent_emails se
          WHERE se.recipient_id = vi.inviter_id
            AND se.email_type = 'voucher_nudge'
        )
      ORDER BY vi.inviter_id
    `, [delayDays])

    // 3. For each voucher, get ALL their invitees across ALL functions and build one email
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

        // Get all invitees across all functions for this voucher
        const inviteesRes = await query(`
          SELECT
            vi.id AS invite_id,
            vi.token,
            vi.status,
            vi.invitee_id,
            vi.job_function_id,
            p.display_name AS invitee_name,
            p.email AS invitee_email,
            jf.name AS jf_name,
            jf.practitioner_label
          FROM vouch_invites vi
          JOIN people p ON p.id = vi.invitee_id
          JOIN job_functions jf ON jf.id = vi.job_function_id
          WHERE vi.inviter_id = $1
            AND vi.inviter_id != vi.invitee_id
          ORDER BY vi.created_at ASC
        `, [voucher.inviter_id])

        const invitees = inviteesRes.rows
        const pending = invitees.filter(i => i.status === 'pending')

        if (pending.length === 0) {
          results.skipped++
          continue
        }

        // Detect Gmail for compose links
        const isGmail = voucher.voucher_email?.toLowerCase().endsWith('@gmail.com')

        // Compute counts early — needed for network CTA
        const totalPending = pending.length
        const totalInvitees = invitees.length
        const completedCount = totalInvitees - totalPending

        // Compute network size for CTA
        let networkSize = 0
        try {
          const recs = await getTalentRecommendations(voucher.inviter_id, null, {
            crossFunctionDiscount,
            siblingCoefficient,
          })
          networkSize = recs.length
        } catch (err) {
          console.error(`[VoucherNudge] Failed to get network size for ${voucher.voucher_name}:`, err.message)
        }

        // Generate login token + talent URL for network CTA
        let talentUrl = ''
        let networkCtaHtml = ''
        const slug = voucher.voucher_linkedin_url?.split('/in/')[1]?.replace(/\/$/, '')
        if (slug) {
          const loginToken = crypto.randomUUID()
          await query(`
            INSERT INTO login_tokens (token, person_id, expires_at)
            VALUES ($1, $2, NOW() + INTERVAL '30 days')
          `, [loginToken, voucher.inviter_id])
          talentUrl = `${BASE_URL}/talent/${slug}?token=${loginToken}`

          const vouchedByClause = voucher.vouched_by_first_name
            ? `the recommendations from ${voucher.vouched_by_first_name} who vouched for you, in addition to `
            : ''

          if (networkSize > 0) {
            networkCtaHtml = `<div style="margin:0 0 20px;padding:16px 20px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;">
              <p style="font-size:14px;color:#15803D;margin:0 0 10px;line-height:1.5;">
                Hi ${firstName} — your VouchFour network is starting to come together. Since you get access to ${vouchedByClause}the recommendations from your own picks, your custom talent network already has <strong>${networkSize}+</strong> highly recommended people — and will keep getting better from here. Want to check it out?
              </p>
              <a href="${talentUrl}" style="display:inline-block;padding:8px 18px;background:#16A34A;color:#FFFFFF;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">View Your Network →</a>
            </div>`
          } else {
            networkCtaHtml = `<div style="margin:0 0 20px;padding:16px 20px;background:#F5F3FF;border:1px solid #DDD6FE;border-radius:8px;">
              <p style="font-size:14px;color:#5B21B6;margin:0 0 10px;line-height:1.5;">
                Hi ${firstName} — your network will populate as your picks respond — you can preview it anytime.
              </p>
              <a href="${talentUrl}" style="display:inline-block;padding:8px 18px;background:#7C3AED;color:#FFFFFF;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">Preview Your Network →</a>
            </div>`
          }
        }

        // Build flat table — pending first, then completed
        const sorted = [...invitees].sort((a, b) => {
          if (a.status === 'pending' && b.status !== 'pending') return -1
          if (a.status !== 'pending' && b.status === 'pending') return 1
          return 0
        })

        const tableRows = sorted.map(inv => {
          if (inv.status !== 'pending') {
            return `<tr>
              <td style="padding:8px 0 8px 14px;border-bottom:1px solid #F3F4F6;font-size:13px;font-weight:600;color:#1C1917;">${inv.invitee_name}</td>
              <td style="padding:8px 0;border-bottom:1px solid #F3F4F6;text-align:center;font-size:12px;color:#16A34A;">✅</td>
              <td colspan="2" style="padding:8px 14px 8px 0;border-bottom:1px solid #F3F4F6;"></td>
            </tr>`
          }

          const vouchUrl = `${BASE_URL}/vouch?token=${inv.token}`
          const inviteeFirst = inv.invitee_name.split(' ')[0]
          const practLabel = (inv.practitioner_label || inv.jf_name || '').toLowerCase()
          const voucherFirst = voucher.voucher_name.split(' ')[0]
          const composeSubject = `Quick favor`
          const composeBody = `Hey ${inviteeFirst},\n\nI am trying out VouchFour to build out a professional network without the noise - just people who are highly recommended by the people I most respect. You are one of the best ${practLabel} that I've ever worked with and your recommendations would mean a lot to me. If you are game to help, you can do so here:\n\n${vouchUrl}\n\nThanks!\n${voucherFirst}`
          const smsBody = `Hey ${inviteeFirst}, I'm trying out VouchFour to build a professional network of just highly recommended people. You're one of the best ${practLabel} I've worked with — would mean a lot if you'd share your picks with me: ${vouchUrl}`

          let composeLink
          if (isGmail) {
            composeLink = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(inv.invitee_email)}&su=${encodeURIComponent(composeSubject)}&body=${encodeURIComponent(composeBody)}`
          } else {
            composeLink = `mailto:${inv.invitee_email}?subject=${encodeURIComponent(composeSubject)}&body=${encodeURIComponent(composeBody)}`
          }
          const smsLink = `sms:?&body=${encodeURIComponent(smsBody)}`

          return `<tr>
            <td style="padding:8px 0 8px 14px;border-bottom:1px solid #F3F4F6;">
              <div style="font-size:13px;font-weight:600;color:#1C1917;">${inv.invitee_name}</div>
            </td>
            <td style="padding:8px 0;border-bottom:1px solid #F3F4F6;text-align:center;font-size:11px;color:#D97706;white-space:nowrap;">⏳</td>
            <td style="padding:8px 6px;border-bottom:1px solid #F3F4F6;text-align:center;white-space:nowrap;vertical-align:middle;">
              <a href="${composeLink}" style="color:#2563EB;font-size:12px;font-weight:600;text-decoration:none;">✉️ Email</a>
            </td>
            <td style="padding:8px 14px 8px 6px;border-bottom:1px solid #F3F4F6;text-align:center;white-space:nowrap;vertical-align:middle;">
              <a href="${smsLink}" style="color:#2563EB;font-size:12px;font-weight:600;text-decoration:none;">💬 Text</a>
            </td>
          </tr>`
        })

        const inviteeStatusHtml = `<div style="border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;background:#FAFAF9;">
          <div style="padding:12px 14px 8px;background:#F5F5F4;border-bottom:1px solid #E5E7EB;">
            <div style="font-size:14px;font-weight:600;color:#1C1917;margin:0 0 2px;">...but ${totalPending} of your picks haven't responded yet</div>
            <div style="font-size:12px;color:#78716C;">A quick personal email or text nudge from you will help remind them to engage. We've made it easy with links to pre-formatted drafts you can review and send.</div>
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:6px 0 6px 14px;font-size:11px;font-weight:700;color:#78716C;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #E5E7EB;">Your Picks</td>
              <td style="padding:6px 0;font-size:11px;font-weight:700;color:#78716C;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #E5E7EB;text-align:center;">Status</td>
              <td colspan="2" style="padding:6px 14px 6px 0;font-size:11px;font-weight:700;color:#78716C;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #E5E7EB;text-align:center;">Draft Nudges</td>
            </tr>
            ${tableRows.join('')}
          </table>
        </div>`

        // Build template variables
        const firstName = voucher.voucher_name.split(' ')[0]

        const vars = {
          firstName,
          fullName: voucher.voucher_name,
          pendingCount: String(totalPending),
          totalCount: String(totalInvitees),
          completedCount: String(completedCount),
          networkSize: String(networkSize),
          inviteeStatusHtml,
          networkCtaHtml,
          talentUrl,
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

        // Record — one voucher_nudge per person, ever
        await query(
          `INSERT INTO sent_emails (recipient_id, email_type, resend_id)
           VALUES ($1, 'voucher_nudge', $2)
           ON CONFLICT DO NOTHING`,
          [voucher.inviter_id, resendId]
        )

        console.log(`[VoucherNudge] Sent to ${voucher.voucher_name} (${totalPending}/${totalInvitees} pending, network=${networkSize})`)
        trackEvent(String(voucher.inviter_id), 'voucher_nudge_sent', {
          pending_count: totalPending,
          total_count: totalInvitees,
          network_size: networkSize,
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
