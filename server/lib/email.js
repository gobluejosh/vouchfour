import crypto from 'node:crypto'
import { Resend } from 'resend'
import { query } from './db.js'
import { trackEvent } from './posthog.js'

const resend = new Resend(process.env.RESEND_API_KEY)

// Must be a verified domain in Resend, or use their sandbox sender
const FROM_ADDRESS = 'VouchFour <noreply@vouchfour.us>'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

const TEST_EMAIL = 'josh@joshscott.me'

// ─── Unsubscribe token helpers ────────────────────────────────────────────────

const UNSUB_SECRET = process.env.ADMIN_SECRET || 'vouchfour-unsub-key'

function generateUnsubToken(personId) {
  const sig = crypto.createHmac('sha256', UNSUB_SECRET).update(String(personId)).digest('hex').slice(0, 16)
  return `${personId}-${sig}`
}

function unsubscribeUrl(personId) {
  return `${BASE_URL}/unsubscribe?token=${generateUnsubToken(personId)}`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getRecipient(intendedEmail) {
  try {
    const result = await query(
      `SELECT value FROM app_settings WHERE key = 'email_test_mode'`
    )
    const testMode = result.rows[0]?.value === 'true'
    if (testMode) return TEST_EMAIL
  } catch (err) {
    console.error('[Email] Failed to check test mode, defaulting to test:', err.message)
    return TEST_EMAIL // fail-safe: default to test mode
  }
  return intendedEmail
}

async function isUnsubscribed(personId) {
  if (!personId) return false
  const result = await query(
    'SELECT unsubscribed_at FROM people WHERE id = $1',
    [personId]
  )
  return !!result.rows[0]?.unsubscribed_at
}

async function loadTemplate(templateKey) {
  const result = await query(
    'SELECT subject, body_html FROM email_templates WHERE template_key = $1',
    [templateKey]
  )
  if (result.rows.length === 0) {
    throw new Error(`Email template not found: ${templateKey}`)
  }
  return result.rows[0]
}

function applyVariables(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return vars[key] !== undefined ? vars[key] : match
  })
}

// ─── Shared email wrapper ─────────────────────────────────────────────────────

function emailLayout(bodyHtml, personId) {
  const unsubLink = personId
    ? `<a href="${unsubscribeUrl(personId)}" style="color:#A8A29E;text-decoration:underline;">Unsubscribe</a>`
    : ''

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#F7F5F2;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#FFFFFF;border-radius:12px;border:1px solid #E7E5E0;padding:32px 28px;">
    <div style="margin-bottom:24px;">
      <span style="font-size:20px;font-weight:700;color:#1C1917;letter-spacing:-0.5px;">
        Vouch<span style="color:#2563EB;">Four</span>
      </span>
    </div>
    ${bodyHtml}
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #E7E5E0;">
      <p style="font-size:12px;color:#78716C;margin:0 0 12px;line-height:1.6;font-style:italic;">
        "Is this a real thing?"
      </p>
      <p style="font-size:12px;color:#78716C;margin:0 0 10px;line-height:1.6;">
        Yep! VouchFour is brand new, so no surprise if you haven't heard of it.
        <a href="https://www.linkedin.com/in/joshscott/" style="color:#2563EB;text-decoration:none;font-weight:600;">Josh Scott</a>
        built it (with significant help from Claude) because he was tired of a familiar problem:
        LinkedIn was originally meant to map trusted professional relationships, but most of us now
        have hundreds of connections — many of whom we barely know, if at all.
      </p>
      <p style="font-size:12px;color:#78716C;margin:0 0 10px;line-height:1.6;">
        Rather than endlessly asking "do you actually know this person?", Josh wanted a professional
        talent network with real constraints — where every recommendation carries weight because it
        comes from someone you genuinely trust. So he built one.
      </p>
      <p style="font-size:12px;color:#78716C;margin:0;line-height:1.6;">
        Questions or thoughts? <a href="https://www.linkedin.com/in/joshscott/" style="color:#2563EB;text-decoration:none;">Reach out to Josh anytime</a>.
      </p>
    </div>
  </div>
  <div style="max-width:480px;margin:0 auto;padding:16px 28px 32px;text-align:center;">
    <p style="font-size:11px;color:#A8A29E;margin:0;line-height:1.6;">
      VouchFour &middot; 2343 N West Torch Lake Dr., Kewadin, MI 49648
    </p>
    <p style="font-size:11px;color:#A8A29E;margin:6px 0 0;line-height:1.6;">
      ${unsubLink}
    </p>
  </div>
</body>
</html>`
}

// ─── Send helper (adds List-Unsubscribe headers) ─────────────────────────────

async function sendEmail({ to, subject, html, personId, templateKey }) {
  const headers = {}
  if (personId) {
    const unsub = unsubscribeUrl(personId)
    headers['List-Unsubscribe'] = `<${unsub}>`
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }

  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [to],
    subject,
    html,
    headers,
  })

  if (error) throw new Error(`Resend error: ${error.message}`)

  if (personId) {
    trackEvent(String(personId), 'email_sent', {
      person_id: personId,
      template_key: templateKey || 'unknown',
    })
  }

  return data?.id
}

// ─── Template 4: Please Vouch (sent to connectors after network form) ─────────

export async function sendPleaseVouchEmail(connector, inviterFirstName, vouchToken) {
  if (await isUnsubscribed(connector.id)) {
    console.log(`[Email] Skipping please_vouch — ${connector.display_name} is unsubscribed`)
    return null
  }

  const vouchUrl = `${BASE_URL}/vouch?token=${vouchToken}`
  const firstName = connector.display_name.split(' ')[0]

  const template = await loadTemplate('please_vouch')
  const vars = { firstName, inviterFirstName, vouchUrl }

  const subject = applyVariables(template.subject, vars)
  const bodyHtml = applyVariables(template.body_html, vars)
  const html = emailLayout(bodyHtml, connector.id)

  const recipient = await getRecipient(connector.email)
  const id = await sendEmail({ to: recipient, subject, html, personId: connector.id, templateKey: 'please_vouch' })

  console.log(`[Email] Sent please_vouch to ${connector.display_name} (${id})`)
  return id
}

// ─── Template 1: Talent Network Ready ─────────────────────────────────────────

export async function sendTalentReadyEmail(person, slug, loginToken, jobFunctionName = '', practitionerLabel = '') {
  if (await isUnsubscribed(person.id)) {
    console.log(`[Email] Skipping talent_ready — ${person.display_name} is unsubscribed`)
    return null
  }

  const talentUrl = `${BASE_URL}/talent/${slug}?token=${loginToken}`
  const firstName = person.display_name.split(' ')[0]

  const template = await loadTemplate('talent_ready')
  const vars = { firstName, talentUrl, jobFunction: jobFunctionName, jobFunctionShort: practitionerLabel || jobFunctionName }

  const subject = applyVariables(template.subject, vars)
  const bodyHtml = applyVariables(template.body_html, vars)
  const html = emailLayout(bodyHtml, person.id)

  const recipient = await getRecipient(person.email)
  const id = await sendEmail({ to: recipient, subject, html, personId: person.id, templateKey: 'talent_ready' })

  console.log(`[Email] Sent talent_ready to ${person.display_name} (${id})`)
  return id
}

// ─── Template 2: Login Link ──────────────────────────────────────────────────

export async function sendLoginLinkEmail(person, slug, loginToken) {
  // Login links are transactional — don't block on unsubscribe
  const talentUrl = `${BASE_URL}/talent/${slug}?token=${loginToken}`
  const firstName = person.display_name.split(' ')[0]

  const template = await loadTemplate('login_link')
  const vars = { firstName, talentUrl }

  const subject = applyVariables(template.subject, vars)
  const bodyHtml = applyVariables(template.body_html, vars)
  const html = emailLayout(bodyHtml, person.id)

  const recipient = await getRecipient(person.email)
  const id = await sendEmail({ to: recipient, subject, html, personId: person.id, templateKey: 'login_link' })

  console.log(`[Email] Sent login_link to ${person.display_name} (${id})`)
  return id
}

// ─── Template 3: You Were Vouched ────────────────────────────────────────────

export async function sendYouWereVouchedEmail(talentPerson, vouchToken, voucherName) {
  if (await isUnsubscribed(talentPerson.id)) {
    console.log(`[Email] Skipping you_were_vouched — ${talentPerson.display_name} is unsubscribed`)
    return null
  }

  const vouchUrl = `${BASE_URL}/vouch?token=${vouchToken}`
  const firstName = talentPerson.display_name.split(' ')[0]

  const template = await loadTemplate('you_were_vouched')
  const vars = { firstName, voucherName, vouchUrl }

  const subject = applyVariables(template.subject, vars)
  const bodyHtml = applyVariables(template.body_html, vars)
  const html = emailLayout(bodyHtml, talentPerson.id)

  const recipient = await getRecipient(talentPerson.email)
  const id = await sendEmail({ to: recipient, subject, html, personId: talentPerson.id, templateKey: 'you_were_vouched' })

  console.log(`[Email] Sent you_were_vouched to ${talentPerson.display_name} (${id})`)
  return id
}

// ─── Template 7: Vouch Invite (sent to vouchees in the new chain model) ──────

export async function sendVouchInviteEmail(vouchee, inviterFullName, jobFunction, vouchToken) {
  if (await isUnsubscribed(vouchee.id)) {
    console.log(`[Email] Skipping vouch_invite — ${vouchee.display_name} is unsubscribed`)
    return null
  }

  const vouchUrl = `${BASE_URL}/vouch?token=${vouchToken}`
  const firstName = vouchee.display_name.split(' ')[0]
  const inviterFirstName = inviterFullName.split(' ')[0]
  const inviterLastName = inviterFullName.split(' ').slice(1).join(' ')

  const practitionerLabel = jobFunction.practitionerLabel || jobFunction.name

  const template = await loadTemplate('vouch_invite')
  const vars = {
    firstName,
    inviterFirstName,
    inviterLastName,
    inviterFullName,
    jobFunction: jobFunction.name,
    jobFunctionShort: practitionerLabel,
    practitionerLabel,
    vouchUrl,
  }

  const subject = applyVariables(template.subject, vars)
  const bodyHtml = applyVariables(template.body_html, vars)
  const html = emailLayout(bodyHtml, vouchee.id)

  const recipient = await getRecipient(vouchee.email)
  const id = await sendEmail({ to: recipient, subject, html, personId: vouchee.id, templateKey: 'vouch_invite' })

  console.log(`[Email] Sent vouch_invite to ${vouchee.display_name} for ${practitionerLabel} (${id})`)
  return id
}

// ─── Template 5: Role Network (sent to recommenders for role-specific vouch) ─

export async function sendRoleNetworkEmail(connector, inviterFirstName, role, vouchToken) {
  if (await isUnsubscribed(connector.id)) {
    console.log(`[Email] Skipping role_network — ${connector.display_name} is unsubscribed`)
    return null
  }

  const vouchUrl = `${BASE_URL}/vouch?token=${vouchToken}&role=${role.slug}`
  const firstName = connector.display_name.split(' ')[0]

  const specialSkillsHtml = role.special_skills
    ? `<div style="font-size:13px;color:#78716C;margin-top:4px;">Skills: ${role.special_skills}</div>`
    : ''

  const template = await loadTemplate('role_network')
  const vars = {
    firstName,
    inviterFirstName,
    jobFunction: role.job_function,
    level: role.level,
    specialSkillsHtml,
    vouchUrl,
  }

  const subject = applyVariables(template.subject, vars)
  const bodyHtml = applyVariables(template.body_html, vars)
  const html = emailLayout(bodyHtml, connector.id)

  const recipient = await getRecipient(connector.email)
  const id = await sendEmail({ to: recipient, subject, html, personId: connector.id, templateKey: 'role_network' })

  console.log(`[Email] Sent role_network to ${connector.display_name} (${id})`)
  return id
}

// ─── Template 6: Role Ready (sent to creator when role threshold met) ────────

export async function sendRoleReadyEmail(person, role, loginToken) {
  if (await isUnsubscribed(person.id)) {
    console.log(`[Email] Skipping role_ready — ${person.display_name} is unsubscribed`)
    return null
  }

  const roleUrl = `${BASE_URL}/role/${role.slug}?token=${loginToken}`
  const firstName = person.display_name.split(' ')[0]

  const template = await loadTemplate('role_ready')
  const vars = {
    firstName,
    jobFunction: role.job_function,
    level: role.level,
    roleUrl,
  }

  const subject = applyVariables(template.subject, vars)
  const bodyHtml = applyVariables(template.body_html, vars)
  const html = emailLayout(bodyHtml, person.id)

  const recipient = await getRecipient(person.email)
  const id = await sendEmail({ to: recipient, subject, html, personId: person.id, templateKey: 'role_ready' })

  console.log(`[Email] Sent role_ready to ${person.display_name} for role ${role.slug} (${id})`)
  return id
}
