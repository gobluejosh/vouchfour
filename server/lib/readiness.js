import crypto from 'node:crypto'
import { query } from './db.js'
import { sendTalentReadyEmail, sendRoleReadyEmail } from './email.js'

/**
 * Called after every vouch submission. Checks if the original network submitter's
 * readiness threshold has been crossed, and if so, sends them a "talent ready" email.
 *
 * Threshold: completed >= min_threshold OR (completed/total * 100) >= pct_threshold
 */
export async function checkAndNotifyReadiness(inviterId) {
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

    // 2. Count unique completed vs total invitees for this inviter
    const countRes = await query(`
      SELECT
        COUNT(DISTINCT invitee_id) AS total,
        COUNT(DISTINCT invitee_id) FILTER (WHERE status = 'completed') AS completed
      FROM vouch_invites
      WHERE inviter_id = $1
    `, [inviterId])

    const { total, completed } = countRes.rows[0]
    const totalNum = Number(total)
    const completedNum = Number(completed)

    if (totalNum === 0) return

    const pct = (completedNum / totalNum) * 100
    const thresholdMet = completedNum >= minThreshold || pct >= pctThreshold

    if (!thresholdMet) {
      console.log(`[Readiness] ${completedNum}/${totalNum} (${pct.toFixed(0)}%) — not yet ready for inviter ${inviterId}`)
      return
    }

    // 3. Try to insert sent_emails record — unique index prevents duplicates
    //    If insert succeeds (returns a row), we should send the email.
    //    If it conflicts (returns nothing), email was already sent.
    const insertRes = await query(`
      INSERT INTO sent_emails (recipient_id, email_type)
      VALUES ($1, 'talent_ready')
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [inviterId])

    if (insertRes.rows.length === 0) {
      console.log(`[Readiness] Talent ready email already sent to inviter ${inviterId}, skipping`)
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

    // 5. Generate login token
    const loginToken = crypto.randomUUID()
    await query(`
      INSERT INTO login_tokens (token, person_id, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '7 days')
    `, [loginToken, inviterId])

    // 6. Send the email
    const slug = person.linkedin_url.split('/in/')[1]
    const resendId = await sendTalentReadyEmail(person, slug, loginToken)

    // 7. Update sent_emails with the resend ID
    await query(
      `UPDATE sent_emails SET resend_id = $1 WHERE id = $2`,
      [resendId, insertRes.rows[0].id]
    )

    console.log(`[Readiness] ✓ Talent ready email sent to ${person.display_name} (${completedNum}/${totalNum})`)
  } catch (err) {
    console.error(`[Readiness] Error checking readiness for inviter ${inviterId}:`, err.message)
  }
}

/**
 * Called after every role-specific vouch submission. Checks if the role's
 * readiness threshold has been crossed, and if so, sends a "role ready" email.
 *
 * Uses same global thresholds as checkAndNotifyReadiness.
 */
export async function checkRoleReadiness(roleId) {
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

    // 2. Count unique completed vs total invitees for this role
    const countRes = await query(`
      SELECT
        COUNT(DISTINCT invitee_id) AS total,
        COUNT(DISTINCT invitee_id) FILTER (WHERE status = 'completed') AS completed
      FROM role_invites
      WHERE role_id = $1
    `, [roleId])

    const { total, completed } = countRes.rows[0]
    const totalNum = Number(total)
    const completedNum = Number(completed)

    if (totalNum === 0) return

    const pct = (completedNum / totalNum) * 100
    const thresholdMet = completedNum >= minThreshold || pct >= pctThreshold

    if (!thresholdMet) {
      console.log(`[RoleReadiness] ${completedNum}/${totalNum} (${pct.toFixed(0)}%) — not yet ready for role ${roleId}`)
      return
    }

    // 3. Get role details including creator
    const roleRes = await query(
      `SELECT id, slug, job_function, level, special_skills, creator_id
       FROM roles WHERE id = $1`,
      [roleId]
    )
    if (roleRes.rows.length === 0) return
    const role = roleRes.rows[0]

    // 4. Try to insert sent_emails record — unique index prevents duplicates per role
    const insertRes = await query(`
      INSERT INTO sent_emails (recipient_id, email_type, reference_id)
      VALUES ($1, 'role_ready', $2)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [role.creator_id, roleId])

    if (insertRes.rows.length === 0) {
      console.log(`[RoleReadiness] Role ready email already sent for role ${roleId}, skipping`)
      return
    }

    // 5. Look up creator person details
    const personRes = await query(
      `SELECT id, display_name, email, linkedin_url FROM people WHERE id = $1`,
      [role.creator_id]
    )
    const person = personRes.rows[0]

    if (!person?.email) {
      console.log(`[RoleReadiness] Creator ${role.creator_id} has no email, can't send notification`)
      return
    }

    // 6. Generate login token
    const loginToken = crypto.randomUUID()
    await query(`
      INSERT INTO login_tokens (token, person_id, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '7 days')
    `, [loginToken, role.creator_id])

    // 7. Send the email
    const resendId = await sendRoleReadyEmail(person, role, loginToken)

    // 8. Update sent_emails with the resend ID
    await query(
      `UPDATE sent_emails SET resend_id = $1 WHERE id = $2`,
      [resendId, insertRes.rows[0].id]
    )

    console.log(`[RoleReadiness] ✓ Role ready email sent to ${person.display_name} for role ${role.slug} (${completedNum}/${totalNum})`)
  } catch (err) {
    console.error(`[RoleReadiness] Error checking readiness for role ${roleId}:`, err.message)
  }
}
