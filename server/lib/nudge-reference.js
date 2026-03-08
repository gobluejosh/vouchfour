/**
 * REFERENCE FILE — Deprecated nudge email logic (removed 2026-03-08)
 *
 * This file preserves the voucher nudge email builder for potential future reuse.
 * The voucher_nudge email template in the DB uses two dynamically-generated HTML
 * blocks ({{inviteeStatusHtml}} and {{networkCtaHtml}}) that were built by
 * processVoucherNudges() in the original server/lib/nudge.js.
 *
 * This file is NOT imported anywhere — it's reference only.
 *
 * Original DB template: SELECT * FROM email_templates WHERE template_key = 'voucher_nudge';
 * Template variables: firstName, fullName, pendingCount, totalCount, completedCount,
 *   networkSize, inviteeStatusHtml, networkCtaHtml, talentUrl
 */

// ─── Network CTA Block ──────────────────────────────────────────────────────
// Generates a green (has network) or purple (empty network) CTA card with a
// login-token link to the voucher's talent page.

function buildNetworkCtaHtml({ firstName, vouchedByFirstName, networkSize, talentUrl }) {
  if (networkSize > 0) {
    const vouchedByClause = vouchedByFirstName
      ? `the recommendations from ${vouchedByFirstName} who vouched for you, in addition to `
      : ''
    return `<div style="margin:0 0 20px;padding:16px 20px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;">
      <p style="font-size:14px;color:#15803D;margin:0 0 10px;line-height:1.5;">
        Hi ${firstName} — your VouchFour network is starting to come together. Since you get access to ${vouchedByClause}the recommendations from your own picks, your custom talent network already has <strong>${networkSize}+</strong> highly recommended people — and will keep getting better from here. Want to check it out?
      </p>
      <a href="${talentUrl}" style="display:inline-block;padding:8px 18px;background:#16A34A;color:#FFFFFF;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">View Your Network →</a>
    </div>`
  }
  return `<div style="margin:0 0 20px;padding:16px 20px;background:#F5F3FF;border:1px solid #DDD6FE;border-radius:8px;">
    <p style="font-size:14px;color:#5B21B6;margin:0 0 10px;line-height:1.5;">
      Hi ${firstName} — your network will populate as your picks respond — you can preview it anytime.
    </p>
    <a href="${talentUrl}" style="display:inline-block;padding:8px 18px;background:#7C3AED;color:#FFFFFF;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">Preview Your Network →</a>
  </div>`
}

// ─── Invitee Status Table ────────────────────────────────────────────────────
// Generates a table showing each pick's status (completed ✅ or pending ⏳)
// with pre-formatted Gmail compose / mailto / SMS links for pending picks.

function buildInviteeStatusHtml({ invitees, voucherName, voucherEmail, totalPending, totalInvitees }) {
  const isGmail = voucherEmail?.toLowerCase().endsWith('@gmail.com')
  const voucherFirst = voucherName.split(' ')[0]
  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

  // Sort: pending first, then completed
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

  return `<div style="border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;background:#FAFAF9;">
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
}
