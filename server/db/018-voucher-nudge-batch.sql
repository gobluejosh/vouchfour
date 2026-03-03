-- VouchFour Migration 018: Batch voucher nudge into one email per person
-- Changes dedup from per-function to per-person (one voucher_nudge ever).
-- Updates template to be function-agnostic (status list built in code).
-- Run: psql -d vouchfour -f server/db/018-voucher-nudge-batch.sql

-- ─── Replace per-function index with per-person index ──────────────────
DROP INDEX IF EXISTS idx_sent_emails_voucher_nudge_per_fn;

CREATE UNIQUE INDEX idx_sent_emails_voucher_nudge_per_person
    ON sent_emails(recipient_id)
    WHERE email_type = 'voucher_nudge';

-- ─── Update template to be function-agnostic ───────────────────────────
UPDATE email_templates
SET subject   = 'Some of your picks need a nudge',
    body_html = '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{firstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      About a week ago you shared your top picks on VouchFour —
      but {{pendingCount}} of your {{totalCount}} picks haven''t responded yet.
      A quick personal text or email from you goes a long way.
    </p>
    <div style="margin:0 0 24px;">
      {{inviteeStatusHtml}}
    </div>
    <p style="font-size:13px;color:#78716C;line-height:1.5;margin:0;">
      People are much more likely to act when they hear from you directly.
    </p>',
    available_vars = 'firstName,fullName,pendingCount,totalCount,completedCount,inviteeStatusHtml'
WHERE template_key = 'voucher_nudge';
