-- VouchFour Migration 023: Quick Ask — AI-drafted network outreach
-- Run: psql -d vouchfour -f server/db/023-quick-ask.sql

-- ─── quick_asks: one row per "ask" action by a sender ────────────────────────
CREATE TABLE IF NOT EXISTS quick_asks (
    id          SERIAL PRIMARY KEY,
    sender_id   INTEGER NOT NULL REFERENCES people(id),
    question    TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quick_asks_sender
    ON quick_asks(sender_id, created_at);

-- ─── quick_ask_recipients: one row per recipient within an ask ───────────────
CREATE TABLE IF NOT EXISTS quick_ask_recipients (
    id              SERIAL PRIMARY KEY,
    ask_id          INTEGER NOT NULL REFERENCES quick_asks(id),
    recipient_id    INTEGER NOT NULL REFERENCES people(id),
    vouch_path      JSONB NOT NULL,
    draft_subject   TEXT,
    draft_body      TEXT,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sent', 'failed')),
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quick_ask_recipients_ask
    ON quick_ask_recipients(ask_id);
CREATE INDEX IF NOT EXISTS idx_quick_ask_recipients_recipient
    ON quick_ask_recipients(recipient_id, created_at);

-- ─── Expand sent_emails email_type CHECK to include quick_ask ────────────────
ALTER TABLE sent_emails DROP CONSTRAINT IF EXISTS sent_emails_email_type_check;
ALTER TABLE sent_emails ADD CONSTRAINT sent_emails_email_type_check
    CHECK (email_type IN (
        'talent_ready', 'login_link', 'you_were_vouched', 'please_vouch',
        'role_network', 'role_ready', 'vouch_invite',
        'nudge_1', 'nudge_2', 'voucher_nudge',
        'quick_ask'
    ));

-- ─── Rate limit settings ────────────────────────────────────────────────────
INSERT INTO app_settings (key, value) VALUES
    ('quick_ask_max_recipients', '3')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value) VALUES
    ('quick_ask_max_sends_per_week', '3')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value) VALUES
    ('quick_ask_max_receives_per_week', '3')
ON CONFLICT (key) DO NOTHING;

-- ─── Quick Ask email template ────────────────────────────────────────────────
INSERT INTO email_templates (template_key, subject, body_html, available_vars) VALUES (
    'quick_ask',
    '{{senderFirstName}} {{senderLastName}} has a question for you',
    '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{recipientFirstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      <strong>{{senderName}}</strong> is reaching out through VouchFour — a professional network built on trusted vouches.
    </p>
    <div style="margin:16px 0;padding:16px 20px;background:#F8F7F6;border-radius:12px;border-left:4px solid #4F46E5;">
      <div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
        How you''re connected
      </div>
      {{vouchChainHtml}}
    </div>
    <div style="margin:16px 0;padding:16px 20px;background:#FFFFFF;border:1.5px solid #E7E5E0;border-radius:12px;">
      <div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
        Message from {{senderFirstName}}
      </div>
      <div style="font-size:15px;color:#1C1917;line-height:1.6;">
        {{messageBody}}
      </div>
    </div>
    <p style="font-size:14px;color:#44403C;line-height:1.6;margin:16px 0 4px;">
      You can reply to {{senderFirstName}} at <a href="mailto:{{senderEmail}}" style="color:#4F46E5;text-decoration:none;font-weight:600;">{{senderEmail}}</a>.
    </p>
    <div style="margin:20px 0;">
      <a href="{{profileUrl}}" style="display:inline-block;padding:10px 24px;background:#4F46E5;color:#FFFFFF;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">View {{senderFirstName}}''s Profile</a>
    </div>',
    'senderName,senderFirstName,senderLastName,senderEmail,recipientFirstName,recipientName,vouchChainHtml,messageBody,profileUrl'
) ON CONFLICT (template_key) DO NOTHING;
