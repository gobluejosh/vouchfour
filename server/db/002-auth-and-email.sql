-- VouchFour Migration 002: Auth, Sessions, and Email Tracking
-- Run: psql -d vouchfour -f server/db/002-auth-and-email.sql

-- ─── Login tokens: magic link auth ─────────────────────────────────────────────
-- Generated when a user needs to access their talent page.
-- Embedded in email links: /talent/{slug}?token={token}
CREATE TABLE IF NOT EXISTS login_tokens (
    id              SERIAL PRIMARY KEY,
    token           TEXT NOT NULL UNIQUE,
    person_id       INTEGER NOT NULL REFERENCES people(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_login_tokens_token ON login_tokens(token);
CREATE INDEX IF NOT EXISTS idx_login_tokens_person ON login_tokens(person_id);

-- ─── Sessions: cookie-based auth after token validation ────────────────────────
-- Created when a login token is validated. Session token stored in httpOnly cookie.
CREATE TABLE IF NOT EXISTS sessions (
    id              SERIAL PRIMARY KEY,
    token           TEXT NOT NULL UNIQUE,
    person_id       INTEGER NOT NULL REFERENCES people(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- ─── Sent emails: audit log + dedup ────────────────────────────────────────────
-- Tracks every email sent. Unique partial indexes prevent duplicate
-- one-time notifications (talent_ready, you_were_vouched).
CREATE TABLE IF NOT EXISTS sent_emails (
    id              SERIAL PRIMARY KEY,
    recipient_id    INTEGER NOT NULL REFERENCES people(id),
    email_type      TEXT NOT NULL CHECK (email_type IN (
        'talent_ready',
        'login_link',
        'you_were_vouched',
        'please_vouch'
    )),
    reference_id    INTEGER,
    resend_id       TEXT,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sent_emails_recipient_type
    ON sent_emails(recipient_id, email_type);

-- Only one "talent_ready" email per person, ever
CREATE UNIQUE INDEX IF NOT EXISTS idx_sent_emails_talent_ready_unique
    ON sent_emails(recipient_id, email_type) WHERE email_type = 'talent_ready';

-- Only one "you_were_vouched" email per talent person, ever
CREATE UNIQUE INDEX IF NOT EXISTS idx_sent_emails_you_were_vouched_unique
    ON sent_emails(recipient_id, email_type) WHERE email_type = 'you_were_vouched';

-- ─── App settings: admin-adjustable config ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed readiness thresholds
INSERT INTO app_settings (key, value) VALUES
    ('readiness_threshold_pct', '30'),
    ('readiness_threshold_min', '2')
ON CONFLICT (key) DO NOTHING;
