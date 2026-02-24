-- VouchFour Migration 005: Job-Function-Based Vouch Chains
-- Run: psql -d vouchfour -f server/db/005-pivot.sql
--
-- This migration pivots the data model from recommender→vouch to direct vouch chains.
-- Old tables (edges, roles, role_invites, role_people) are preserved, not dropped.

-- ─── Job functions lookup table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_functions (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    slug            TEXT NOT NULL UNIQUE,
    display_order   INTEGER NOT NULL DEFAULT 0
);

INSERT INTO job_functions (name, slug, display_order) VALUES
    ('Engineering / Software Development', 'engineering', 1),
    ('Product Management', 'product', 2),
    ('Marketing', 'marketing', 3),
    ('Sales', 'sales', 4),
    ('Design (Product/UX)', 'design', 5),
    ('Data / Analytics', 'data', 6),
    ('Finance / Accounting', 'finance', 7),
    ('Operations', 'operations', 8),
    ('People / HR', 'people-hr', 9),
    ('Customer Success', 'customer-success', 10)
ON CONFLICT (slug) DO NOTHING;

-- ─── Vouches table (replaces edges for the new model) ──────────────────────
CREATE TABLE IF NOT EXISTS vouches (
    id              SERIAL PRIMARY KEY,
    voucher_id      INTEGER NOT NULL REFERENCES people(id),
    vouchee_id      INTEGER NOT NULL REFERENCES people(id),
    job_function_id INTEGER NOT NULL REFERENCES job_functions(id),
    submission_id   INTEGER REFERENCES submissions(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (voucher_id, vouchee_id, job_function_id)
);

CREATE INDEX IF NOT EXISTS idx_vouches_voucher_fn ON vouches(voucher_id, job_function_id);
CREATE INDEX IF NOT EXISTS idx_vouches_vouchee_fn ON vouches(vouchee_id, job_function_id);

-- ─── Add job_function_id to vouch_invites ──────────────────────────────────
ALTER TABLE vouch_invites ADD COLUMN IF NOT EXISTS job_function_id INTEGER REFERENCES job_functions(id);

-- ─── Add job_function_id to submissions ────────────────────────────────────
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS job_function_id INTEGER REFERENCES job_functions(id);

-- ─── Expand submissions form_type CHECK ────────────────────────────────────
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_form_type_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_form_type_check
    CHECK (form_type IN ('network', 'vouch', 'role_vouch', 'start_vouch'));

-- ─── Expand sent_emails email_type CHECK ───────────────────────────────────
ALTER TABLE sent_emails DROP CONSTRAINT IF EXISTS sent_emails_email_type_check;
ALTER TABLE sent_emails ADD CONSTRAINT sent_emails_email_type_check
    CHECK (email_type IN (
        'talent_ready', 'login_link', 'you_were_vouched', 'please_vouch',
        'role_network', 'role_ready', 'vouch_invite'
    ));

-- ─── Update talent_ready unique index to be per-job-function ───────────────
-- Drop the old index that only allows one talent_ready per person ever.
-- Recreate to allow one per person per job function (reference_id = job_function_id).
DROP INDEX IF EXISTS idx_sent_emails_talent_ready_unique;
CREATE UNIQUE INDEX idx_sent_emails_talent_ready_unique
    ON sent_emails(recipient_id, email_type, reference_id)
    WHERE email_type = 'talent_ready';

-- ─── Seed email_test_mode if not present ───────────────────────────────────
INSERT INTO app_settings (key, value) VALUES
    ('email_test_mode', 'true')
ON CONFLICT (key) DO NOTHING;

-- ─── Seed vouch_invite email template ──────────────────────────────────────
INSERT INTO email_templates (template_key, subject, body_html, available_vars) VALUES (
    'vouch_invite',
    '{{inviterFirstName}} thinks you''re one of the 4 best {{jobFunctionShort}} professionals they''ve ever worked with',
    '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{firstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      <strong>{{inviterFirstName}}</strong> thinks you''re one of the <strong>4 best {{jobFunction}} professionals</strong>
      they''ve ever worked with. That''s a meaningful compliment — they could only pick 4.
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      Given your expertise, {{inviterFirstName}} would love to know: who do YOU think are the best
      {{jobFunction}} professionals you''ve ever worked with?
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 4px;">
      As responses come in, VouchFour will share with you who gets vouched for by the people
      you vouch for — and by the other people {{inviterFirstName}} vouched for as well.
    </p>
    <div style="margin:24px 0;">
      <a href="{{vouchUrl}}" style="display:inline-block;padding:12px 28px;background:#2563EB;color:#FFFFFF;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">Share Your Top 4</a>
    </div>
    <p style="font-size:13px;color:#78716C;line-height:1.5;margin:0;">
      It only takes a couple minutes.
    </p>',
    'firstName,inviterFirstName,jobFunction,jobFunctionShort,vouchUrl'
) ON CONFLICT (template_key) DO NOTHING;

-- ─── Update talent_ready template available_vars to include jobFunction ─────
UPDATE email_templates
SET available_vars = 'firstName,talentUrl,jobFunction'
WHERE template_key = 'talent_ready';

-- ─── Update talent_ready template body to include job function ──────────────
UPDATE email_templates
SET subject = 'Your {{jobFunction}} talent network results are ready',
    body_html = '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{firstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      Great news — enough people have shared their <strong>{{jobFunction}}</strong> picks that
      your talent network results are ready to view.
    </p>
    <div style="margin:24px 0;">
      <a href="{{talentUrl}}" style="display:inline-block;padding:12px 28px;background:#2563EB;color:#FFFFFF;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">View Your Talent Network</a>
    </div>
    <p style="font-size:13px;color:#78716C;line-height:1.5;margin:0;">
      Results are ranked by connection strength and may continue to grow as more people respond.
      This link is unique to you and expires in 7 days.
    </p>'
WHERE template_key = 'talent_ready';
