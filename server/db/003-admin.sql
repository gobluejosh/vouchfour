-- 003-admin.sql: Email templates table + admin settings

-- ─── Email templates (editable via admin page) ──────────────────────────────

CREATE TABLE IF NOT EXISTS email_templates (
    template_key    TEXT PRIMARY KEY,
    subject         TEXT NOT NULL,
    body_html       TEXT NOT NULL,
    available_vars  TEXT NOT NULL DEFAULT '',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: Please Vouch (sent to connectors after network form)
INSERT INTO email_templates (template_key, subject, body_html, available_vars) VALUES (
    'please_vouch',
    '{{inviterFirstName}} wants your talent recommendations',
    '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{firstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      <strong>{{inviterFirstName}}</strong> listed you as one of the people they most trust
      for talent recommendations. They''d love to know — who are the top performers
      you''ve worked with in your career?
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 4px;">
      It only takes a couple of minutes. Just share up to 4 people you''d vouch for:
    </p>
    <div style="margin:24px 0;">
      <a href="{{vouchUrl}}" style="display:inline-block;padding:12px 28px;background:#2563EB;color:#FFFFFF;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">Share Your Recommendations</a>
    </div>
    <p style="font-size:13px;color:#78716C;line-height:1.5;margin:0;">
      Your recommendations will be anonymous — {{inviterFirstName}} will see who was recommended
      but not who specifically recommended them.
    </p>',
    'firstName,inviterFirstName,vouchUrl'
) ON CONFLICT (template_key) DO NOTHING;

-- Seed: Talent Ready (sent when readiness threshold is met)
INSERT INTO email_templates (template_key, subject, body_html, available_vars) VALUES (
    'talent_ready',
    'Your VouchFour talent network is ready',
    '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{firstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      Great news — enough people in your network have shared their talent recommendations
      that your personalized talent network is ready to explore.
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 4px;">
      Click below to see who your network recommends:
    </p>
    <div style="margin:24px 0;">
      <a href="{{talentUrl}}" style="display:inline-block;padding:12px 28px;background:#2563EB;color:#FFFFFF;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">View Your Talent Network</a>
    </div>
    <p style="font-size:13px;color:#78716C;line-height:1.5;margin:0;">
      This link is unique to you and expires in 7 days. You can always request a new one.
    </p>',
    'firstName,talentUrl'
) ON CONFLICT (template_key) DO NOTHING;

-- Seed: Login Link (sent for magic link login)
INSERT INTO email_templates (template_key, subject, body_html, available_vars) VALUES (
    'login_link',
    'Your VouchFour login link',
    '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{firstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      You requested access to your VouchFour talent network. Click below to log in:
    </p>
    <div style="margin:24px 0;">
      <a href="{{talentUrl}}" style="display:inline-block;padding:12px 28px;background:#2563EB;color:#FFFFFF;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">View Your Talent Network</a>
    </div>
    <p style="font-size:13px;color:#78716C;line-height:1.5;margin:0;">
      This link is unique to you and expires in 7 days. If you didn''t request this, you can ignore this email.
    </p>',
    'firstName,talentUrl'
) ON CONFLICT (template_key) DO NOTHING;

-- Seed: You Were Vouched (sent when someone recommends you)
INSERT INTO email_templates (template_key, subject, body_html, available_vars) VALUES (
    'you_were_vouched',
    'Someone thinks you''re exceptional',
    '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{firstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      <strong>{{voucherName}}</strong> thinks you''re exceptional and recommended you
      as one of the 4 highest performers they''ve ever worked with.
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 4px;">
      Want to pay it forward by sharing this same compliment with great folks from
      your network? Who do you VouchFour?
    </p>
    <div style="margin:24px 0;">
      <a href="{{vouchUrl}}" style="display:inline-block;padding:12px 28px;background:#2563EB;color:#FFFFFF;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">Vouch for Others</a>
    </div>
    <p style="font-size:13px;color:#78716C;line-height:1.5;margin:0;">
      VouchFour is a talent recommendation platform that surfaces top performers through
      trusted network connections. Your recommendations will be anonymous.
    </p>',
    'firstName,voucherName,vouchUrl'
) ON CONFLICT (template_key) DO NOTHING;

-- ─── Email test mode setting ────────────────────────────────────────────────

INSERT INTO app_settings (key, value) VALUES
    ('email_test_mode', 'true')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value) VALUES
    ('cross_function_discount', '0.5')
ON CONFLICT (key) DO NOTHING;
