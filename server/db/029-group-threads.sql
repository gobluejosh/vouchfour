-- VouchFour Migration 029: Group Threads
-- Run: psql -d vouchfour -f server/db/029-group-threads.sql

-- ── threads: one row per group conversation ────────────────────────────────
CREATE TABLE IF NOT EXISTS threads (
    id              SERIAL PRIMARY KEY,
    creator_id      INTEGER NOT NULL REFERENCES people(id),
    topic           TEXT NOT NULL,
    initial_question TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'archived')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_threads_creator ON threads(creator_id, created_at);

-- ── thread_participants: one row per person in the thread ──────────────────
-- Each participant gets a unique access_token for magic-link auth
CREATE TABLE IF NOT EXISTS thread_participants (
    id              SERIAL PRIMARY KEY,
    thread_id       INTEGER NOT NULL REFERENCES threads(id),
    person_id       INTEGER NOT NULL REFERENCES people(id),
    access_token    TEXT NOT NULL UNIQUE,
    role            TEXT NOT NULL DEFAULT 'participant'
                    CHECK (role IN ('creator', 'participant')),
    vouch_path      JSONB,
    draft_subject   TEXT,
    draft_body      TEXT,
    has_participated BOOLEAN NOT NULL DEFAULT false,
    invited_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(thread_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_thread_participants_token
    ON thread_participants(access_token);
CREATE INDEX IF NOT EXISTS idx_thread_participants_thread
    ON thread_participants(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_participants_person
    ON thread_participants(person_id, created_at);

-- ── thread_messages: flat list of messages ─────────────────────────────────
CREATE TABLE IF NOT EXISTS thread_messages (
    id              SERIAL PRIMARY KEY,
    thread_id       INTEGER NOT NULL REFERENCES threads(id),
    author_id       INTEGER NOT NULL REFERENCES people(id),
    body            TEXT NOT NULL,
    is_initial      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thread_messages_thread
    ON thread_messages(thread_id, created_at);

-- ── Expand sent_emails email_type CHECK to include thread types ────────────
ALTER TABLE sent_emails DROP CONSTRAINT IF EXISTS sent_emails_email_type_check;
ALTER TABLE sent_emails ADD CONSTRAINT sent_emails_email_type_check
    CHECK (email_type IN (
        'talent_ready', 'login_link', 'you_were_vouched', 'please_vouch',
        'role_network', 'role_ready', 'vouch_invite',
        'nudge_1', 'nudge_2', 'voucher_nudge',
        'quick_ask',
        'thread_invite', 'thread_reply_notification'
    ));

-- ── Thread invite email template ───────────────────────────────────────────
INSERT INTO email_templates (template_key, subject, body_html, available_vars) VALUES (
    'thread_invite',
    '{{senderFirstName}} {{senderLastName}} started a conversation',
    '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{recipientFirstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      <strong>{{senderName}}</strong> started a group conversation on VouchFour &mdash; a professional network built on trusted recommendations from highly regarded colleagues.
    </p>
    {{connectionSection}}
    <div style="margin:16px 0;padding:16px 20px;background:#F5F3FF;border:1.5px solid #C4B5FD;border-radius:12px;">
      <div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
        Topic
      </div>
      <div style="font-size:15px;color:#1C1917;line-height:1.6;font-weight:600;">
        {{threadTopic}}
      </div>
    </div>
    <div style="margin:16px 0;padding:16px 20px;background:#FFFFFF;border:1.5px solid #E7E5E0;border-radius:12px;">
      <div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
        Message from {{senderFirstName}}
      </div>
      <div style="font-size:15px;color:#1C1917;line-height:1.6;">
        {{messageBody}}
      </div>
    </div>
    <div style="margin:20px 0;text-align:center;">
      <a href="{{threadUrl}}" style="display:inline-block;padding:12px 28px;background:#4F46E5;color:#FFFFFF;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">View Conversation &amp; Reply</a>
    </div>',
    'senderName,senderFirstName,senderLastName,recipientFirstName,recipientName,connectionSection,threadTopic,messageBody,threadUrl'
) ON CONFLICT (template_key) DO NOTHING;

-- ── Thread reply notification email template ───────────────────────────────
INSERT INTO email_templates (template_key, subject, body_html, available_vars) VALUES (
    'thread_reply_notification',
    '{{replyAuthorFirstName}} replied in "{{threadTopic}}"',
    '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{recipientFirstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      <strong>{{replyAuthorName}}</strong> replied in a group conversation you''re part of.
    </p>
    <div style="margin:16px 0;padding:16px 20px;background:#F5F3FF;border:1.5px solid #C4B5FD;border-radius:12px;">
      <div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
        {{threadTopic}}
      </div>
      <div style="font-size:15px;color:#1C1917;line-height:1.6;">
        {{replyPreview}}
      </div>
    </div>
    <div style="margin:20px 0;text-align:center;">
      <a href="{{threadUrl}}" style="display:inline-block;padding:12px 28px;background:#4F46E5;color:#FFFFFF;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">View Conversation &amp; Reply</a>
    </div>',
    'recipientFirstName,replyAuthorName,replyAuthorFirstName,threadTopic,replyPreview,threadUrl'
) ON CONFLICT (template_key) DO NOTHING;

-- ── Max participants setting ───────────────────────────────────────────────
INSERT INTO app_settings (key, value) VALUES
    ('thread_max_participants', '6')
ON CONFLICT (key) DO NOTHING;
