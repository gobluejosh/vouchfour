import crypto from 'node:crypto'
import { query } from './db.js'
import { sendTalentReadyEmail } from './email.js'
import { trackEvent } from './posthog.js'

/**
 * Called after every vouch submission in the new chain model.
 * Checks if the voucher's readiness threshold has been crossed for a specific
 * job function, and if so, sends them a "talent ready" email.
 *
 * Threshold: completed >= min_threshold OR (completed/total * 100) >= pct_threshold
 *
 * @param {number} inviterId - people.id of the person whose vouchees we're checking
 * @param {number} jobFunctionId - job_functions.id to scope the check
 */
export async function checkAndNotifyReadiness(inviterId, jobFunctionId) {
  try {
    // 1. Get threshold settings
    const settingsRes = await query(
      `SELECT key, value FROM app_settings WHERE key IN ('readiness_threshold_pct', 'readiness_threshold_min')`
    )
    const settings = {}
    for (const row of settingsRes.rows) {
      settings[row.key] = Number(row.value)
    }
    const pctThreshold = settings.readiness_threshold_pct ?? 30
    const minThreshold = settings.readiness_threshold_min ?? 2

    // 2. Count unique completed vs total invitees for this inviter + job function
    const countRes = await query(`
      SELECT
        COUNT(DISTINCT invitee_id) AS total,
        COUNT(DISTINCT invitee_id) FILTER (WHERE status = 'completed') AS completed
      FROM vouch_invites
      WHERE inviter_id = $1 AND job_function_id = $2
        AND invitee_id != inviter_id
    `, [inviterId, jobFunctionId])

    const { total, completed } = countRes.rows[0]
    const totalNum = Number(total)
    const completedNum = Number(completed)

    if (totalNum === 0) return

    const pct = (completedNum / totalNum) * 100
    const thresholdMet = completedNum >= minThreshold || pct >= pctThreshold

    if (!thresholdMet) {
      console.log(`[Readiness] ${completedNum}/${totalNum} (${pct.toFixed(0)}%) — not yet ready for inviter ${inviterId}, fn ${jobFunctionId}`)
      return
    }

    // 3. Try to insert sent_emails record — unique index prevents duplicates per job function
    //    reference_id stores the job_function_id so each function can trigger its own email
    const insertRes = await query(`
      INSERT INTO sent_emails (recipient_id, email_type, reference_id)
      VALUES ($1, 'talent_ready', $2)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [inviterId, jobFunctionId])

    if (insertRes.rows.length === 0) {
      console.log(`[Readiness] Talent ready email already sent to inviter ${inviterId} for fn ${jobFunctionId}, skipping`)
      return
    }

    // 4. Look up person details
    const personRes = await query(
      `SELECT id, display_name, email, linkedin_url FROM people WHERE id = $1`,
      [inviterId]
    )
    const person = personRes.rows[0]

    if (!person?.email) {
      console.log(`[Readiness] Inviter ${inviterId} has no email, can't send notification`)
      return
    }

    // 5. Look up job function name
    const jfRes = await query(
      `SELECT name, practitioner_label FROM job_functions WHERE id = $1`,
      [jobFunctionId]
    )
    const jfRow = jfRes.rows[0]
    const jobFunctionName = jfRow?.name || ''
    const practitionerLabel = jfRow?.practitioner_label || jobFunctionName

    // 6. Generate login token
    const loginToken = crypto.randomUUID()
    await query(`
      INSERT INTO login_tokens (token, person_id, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '7 days')
    `, [loginToken, inviterId])

    // 7. Send the email
    const slug = person.linkedin_url.split('/in/')[1]
    const resendId = await sendTalentReadyEmail(person, slug, loginToken, jobFunctionName, practitionerLabel)

    // 8. Update sent_emails with the resend ID
    await query(
      `UPDATE sent_emails SET resend_id = $1 WHERE id = $2`,
      [resendId, insertRes.rows[0].id]
    )

    console.log(`[Readiness] ✓ Talent ready email sent to ${person.display_name} for ${jobFunctionName} (${completedNum}/${totalNum})`)
    trackEvent(String(inviterId), 'readiness_reached', {
      person_id: inviterId,
      job_function: jobFunctionName,
      completed_count: completedNum,
      total_count: totalNum,
    })
  } catch (err) {
    console.error(`[Readiness] Error checking readiness for inviter ${inviterId}, fn ${jobFunctionId}:`, err.message)
  }
}
