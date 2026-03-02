-- VouchFour Migration 014: Nudge Email System
-- Run: psql -d vouchfour -f server/db/014-nudge-emails.sql

-- ─── Expand sent_emails email_type CHECK to include nudge types ──────────
ALTER TABLE sent_emails DROP CONSTRAINT IF EXISTS sent_emails_email_type_check;
ALTER TABLE sent_emails ADD CONSTRAINT sent_emails_email_type_check
    CHECK (email_type IN (
        'talent_ready', 'login_link', 'you_were_vouched', 'please_vouch',
        'role_network', 'role_ready', 'vouch_invite',
        'nudge_1', 'nudge_2'
    ));

-- ─── Unique indexes: one nudge_1 and one nudge_2 per vouch_invite ────────
-- reference_id stores vouch_invites.id for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_sent_emails_nudge1_unique
    ON sent_emails(recipient_id, email_type, reference_id)
    WHERE email_type = 'nudge_1';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sent_emails_nudge2_unique
    ON sent_emails(recipient_id, email_type, reference_id)
    WHERE email_type = 'nudge_2';

-- ─── Seed nudge settings ─────────────────────────────────────────────────
INSERT INTO app_settings (key, value) VALUES
    ('nudge_1_delay_days', '5'),
    ('nudge_2_delay_days', '12'),
    ('nudge_network_threshold', '5')
ON CONFLICT (key) DO NOTHING;

-- ─── Seed nudge_1 email template ─────────────────────────────────────────
INSERT INTO email_templates (template_key, subject, body_html, available_vars) VALUES (
    'nudge_1',
    '{{inviterFirstName}}''s network is growing — don''t miss out',
    '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{firstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      A few days ago, <strong>{{inviterFullName}}</strong> vouched for you as one of the
      <strong>best {{jobFunction}} professionals</strong> they''ve ever worked with.
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      Since then, a network of <strong>{{networkSize}}+ trusted {{practitionerLabel}}</strong> has started
      forming around {{inviterFirstName}}''s vouches. When you share your picks, you''ll get to
      see who everyone else is recommending too.
    </p>
    <div style="margin:24px 0;">
      <a href="{{vouchUrl}}" style="display:inline-block;padding:12px 28px;background:#2563EB;color:#FFFFFF;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">Share Your Picks</a>
    </div>
    <p style="font-size:13px;color:#78716C;line-height:1.5;margin:0;">
      It only takes a couple minutes.
    </p>',
    'firstName,inviterFirstName,inviterFullName,jobFunction,jobFunctionShort,practitionerLabel,vouchUrl,networkSize,daysSinceInvite'
) ON CONFLICT (template_key) DO NOTHING;

-- ─── Seed nudge_2 email template ─────────────────────────────────────────
INSERT INTO email_templates (template_key, subject, body_html, available_vars) VALUES (
    'nudge_2',
    'Last chance: {{networkSize}}+ {{practitionerLabel}} are waiting',
    '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{firstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      {{inviterFullName}} vouched for you {{daysSinceInvite}} days ago as one of the
      <strong>best {{jobFunction}} professionals</strong> they''ve ever worked with.
      Since then, <strong>{{networkSize}}+ trusted {{practitionerLabel}}</strong> have been recommended
      by the people in this network.
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      Share your picks and you''ll instantly get access to see everyone else''s
      recommendations — a curated talent network built on real trust.
    </p>
    <div style="margin:24px 0;">
      <a href="{{vouchUrl}}" style="display:inline-block;padding:12px 28px;background:#2563EB;color:#FFFFFF;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">Share Your Picks</a>
    </div>
    <p style="font-size:13px;color:#78716C;line-height:1.5;margin:0;">
      It only takes a couple minutes. This is a final reminder.
    </p>',
    'firstName,inviterFirstName,inviterFullName,jobFunction,jobFunctionShort,practitionerLabel,vouchUrl,networkSize,daysSinceInvite'
) ON CONFLICT (template_key) DO NOTHING;
