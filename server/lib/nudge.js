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
    //    - includes subselects for whether nudge_1/nudge_2 already sent
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
           AND se.email_type = 'nudge_1'
           AND se.reference_id = vi.id) AS nudge_1_sent_count,
        (SELECT COUNT(*) FROM sent_emails se
         WHERE se.recipient_id = vi.invitee_id
           AND se.email_type = 'nudge_2'
           AND se.reference_id = vi.id) AS nudge_2_sent_count
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

    // 5. Process each eligible invite
    for (const row of eligibleRes.rows) {
      const daysSince = Number(row.days_since_invite)
      const nudge1AlreadySent = Number(row.nudge_1_sent_count) > 0
      const nudge2AlreadySent = Number(row.nudge_2_sent_count) > 0

      // Determine which nudge to send
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

      try {
        // Check network size (cached per inviter)
        const networkSize = await getNetworkSize(row.inviter_id)
        if (networkSize < networkThreshold) {
          results.skipped++
          continue
        }

        // Check daily email cap (3 per 24hrs)
        const capRes = await query(
          `SELECT COUNT(*) AS cnt FROM sent_emails
           WHERE recipient_id = $1 AND sent_at > NOW() - INTERVAL '24 hours'`,
          [row.invitee_id]
        )
        if (Number(capRes.rows[0].cnt) >= 3) {
          results.skipped++
          continue
        }

        // Build template variables
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
          networkSize: String(networkSize),
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

        // Record in sent_emails (ON CONFLICT prevents duplicates)
        await query(
          `INSERT INTO sent_emails (recipient_id, email_type, reference_id, resend_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [row.invitee_id, nudgeType, row.invite_id, resendId]
        )

        console.log(`[Nudge] Sent ${nudgeType} to ${row.invitee_name} (invite ${row.invite_id}, network=${networkSize})`)
        trackEvent(String(row.invitee_id), 'nudge_sent', {
          nudge_type: nudgeType,
          invite_id: row.invite_id,
          inviter_id: row.inviter_id,
          network_size: networkSize,
          days_since_invite: daysSince,
        })

        if (nudgeType === 'nudge_1') results.nudge_1_sent++
        else results.nudge_2_sent++

      } catch (err) {
        console.error(`[Nudge] Error processing invite ${row.invite_id}:`, err.message)
        results.errors.push({ invite_id: row.invite_id, error: err.message })
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
