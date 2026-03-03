-- VouchFour Migration 017: Voucher Nudge Email
-- Emails vouchers when their picks haven't responded, encouraging personal outreach.
-- One voucher_nudge per voucher per job function, ever.
-- Run: psql -d vouchfour -f server/db/017-voucher-nudge.sql

-- ─── Expand sent_emails email_type CHECK to include voucher_nudge ──────
ALTER TABLE sent_emails DROP CONSTRAINT IF EXISTS sent_emails_email_type_check;
ALTER TABLE sent_emails ADD CONSTRAINT sent_emails_email_type_check
    CHECK (email_type IN (
        'talent_ready', 'login_link', 'you_were_vouched', 'please_vouch',
        'role_network', 'role_ready', 'vouch_invite',
        'nudge_1', 'nudge_2', 'voucher_nudge'
    ));

-- ─── Unique index: one voucher_nudge per person per job function ───────
-- reference_id stores the job_function_id for per-function dedup
CREATE UNIQUE INDEX IF NOT EXISTS idx_sent_emails_voucher_nudge_per_fn
    ON sent_emails(recipient_id, reference_id)
    WHERE email_type = 'voucher_nudge';

-- ─── Seed voucher_nudge setting ────────────────────────────────────────
INSERT INTO app_settings (key, value) VALUES
    ('voucher_nudge_delay_days', '7')
ON CONFLICT (key) DO NOTHING;

-- ─── Seed voucher_nudge email template ─────────────────────────────────
-- Body is minimal because the invitee status list is built dynamically in code
-- and injected as {{inviteeStatusHtml}}
INSERT INTO email_templates (template_key, subject, body_html, available_vars) VALUES (
    'voucher_nudge',
    'Your {{practitionerLabel}} picks need a nudge',
    '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{firstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      A week ago you vouched for your top <strong>{{practitionerLabel}}</strong> —
      but {{pendingCount}} of your {{totalCount}} picks haven''t responded yet.
      A quick personal text or email from you goes a long way.
    </p>
    <div style="margin:0 0 24px;">
      {{inviteeStatusHtml}}
    </div>
    <p style="font-size:13px;color:#78716C;line-height:1.5;margin:0;">
      People are much more likely to act when they hear from you directly.
    </p>',
    'firstName,fullName,practitionerLabel,jobFunction,pendingCount,totalCount,completedCount,inviteeStatusHtml'
) ON CONFLICT (template_key) DO NOTHING;
