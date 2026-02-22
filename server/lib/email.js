import { Resend } from 'resend'
import { query } from './db.js'

const resend = new Resend(process.env.RESEND_API_KEY)

// Must be a verified domain in Resend, or use their sandbox sender
const FROM_ADDRESS = 'VouchFour <onboarding@resend.dev>'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

const TEST_EMAIL = 'josh@joshscott.me'

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

function emailLayout(bodyHtml) {
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
</body>
</html>`
}

// ─── Template 4: Please Vouch (sent to connectors after network form) ─────────

export async function sendPleaseVouchEmail(connector, inviterFirstName, vouchToken) {
  const vouchUrl = `${BASE_URL}/vouch?token=${vouchToken}`
  const firstName = connector.display_name.split(' ')[0]

  const template = await loadTemplate('please_vouch')
  const vars = { firstName, inviterFirstName, vouchUrl }

  const subject = applyVariables(template.subject, vars)
  const bodyHtml = applyVariables(template.body_html, vars)
  const html = emailLayout(bodyHtml)

  const recipient = await getRecipient(connector.email)

  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [recipient],
    subject,
    html,
  })

  if (error) throw new Error(`Resend error: ${error.message}`)

  console.log(`[Email] Sent please_vouch to ${connector.display_name} (${data?.id})`)
  return data?.id
}

// ─── Template 1: Talent Network Ready ─────────────────────────────────────────

export async function sendTalentReadyEmail(person, slug, loginToken) {
  const talentUrl = `${BASE_URL}/talent/${slug}?token=${loginToken}`
  const firstName = person.display_name.split(' ')[0]

  const template = await loadTemplate('talent_ready')
  const vars = { firstName, talentUrl }

  const subject = applyVariables(template.subject, vars)
  const bodyHtml = applyVariables(template.body_html, vars)
  const html = emailLayout(bodyHtml)

  const recipient = await getRecipient(person.email)

  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [recipient],
    subject,
    html,
  })

  if (error) throw new Error(`Resend error: ${error.message}`)

  console.log(`[Email] Sent talent_ready to ${person.display_name} (${data?.id})`)
  return data?.id
}

// ─── Template 2: Login Link ──────────────────────────────────────────────────

export async function sendLoginLinkEmail(person, slug, loginToken) {
  const talentUrl = `${BASE_URL}/talent/${slug}?token=${loginToken}`
  const firstName = person.display_name.split(' ')[0]

  const template = await loadTemplate('login_link')
  const vars = { firstName, talentUrl }

  const subject = applyVariables(template.subject, vars)
  const bodyHtml = applyVariables(template.body_html, vars)
  const html = emailLayout(bodyHtml)

  const recipient = await getRecipient(person.email)

  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [recipient],
    subject,
    html,
  })

  if (error) throw new Error(`Resend error: ${error.message}`)

  console.log(`[Email] Sent login_link to ${person.display_name} (${data?.id})`)
  return data?.id
}

// ─── Template 3: You Were Vouched ────────────────────────────────────────────

export async function sendYouWereVouchedEmail(talentPerson, vouchToken, voucherName) {
  const vouchUrl = `${BASE_URL}/vouch?token=${vouchToken}`
  const firstName = talentPerson.display_name.split(' ')[0]

  const template = await loadTemplate('you_were_vouched')
  const vars = { firstName, voucherName, vouchUrl }

  const subject = applyVariables(template.subject, vars)
  const bodyHtml = applyVariables(template.body_html, vars)
  const html = emailLayout(bodyHtml)

  const recipient = await getRecipient(talentPerson.email)

  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [recipient],
    subject,
    html,
  })

  if (error) throw new Error(`Resend error: ${error.message}`)

  console.log(`[Email] Sent you_were_vouched to ${talentPerson.display_name} (${data?.id})`)
  return data?.id
}

// ─── Template 5: Role Network (sent to recommenders for role-specific vouch) ─

export async function sendRoleNetworkEmail(connector, inviterFirstName, role, vouchToken) {
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
  const html = emailLayout(bodyHtml)

  const recipient = await getRecipient(connector.email)

  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [recipient],
    subject,
    html,
  })

  if (error) throw new Error(`Resend error: ${error.message}`)

  console.log(`[Email] Sent role_network to ${connector.display_name} (${data?.id})`)
  return data?.id
}

// ─── Template 6: Role Ready (sent to creator when role threshold met) ────────

export async function sendRoleReadyEmail(person, role, loginToken) {
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
  const html = emailLayout(bodyHtml)

  const recipient = await getRecipient(person.email)

  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [recipient],
    subject,
    html,
  })

  if (error) throw new Error(`Resend error: ${error.message}`)

  console.log(`[Email] Sent role_ready to ${person.display_name} for role ${role.slug} (${data?.id})`)
  return data?.id
}
