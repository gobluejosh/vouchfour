-- VouchFour Migration 004: Role-Specific Talent Searches
-- Run: psql -d vouchfour -f server/db/004-roles.sql

-- ─── Roles: role-specific talent searches ────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
    id              SERIAL PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE,
    creator_id      INTEGER NOT NULL REFERENCES people(id),
    job_function    TEXT NOT NULL,
    level           TEXT NOT NULL CHECK (level IN ('C-Level', 'VP-Level', 'Dir-Level', 'Mgr-Level', 'IC-Level')),
    special_skills  TEXT,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roles_creator ON roles(creator_id);

-- ─── Role invites: token-based role-specific vouch invitations ───────────────
CREATE TABLE IF NOT EXISTS role_invites (
    id              SERIAL PRIMARY KEY,
    token           TEXT NOT NULL UNIQUE,
    role_id         INTEGER NOT NULL REFERENCES roles(id),
    inviter_id      INTEGER NOT NULL REFERENCES people(id),
    invitee_id      INTEGER NOT NULL REFERENCES people(id),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'completed', 'expired')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_role_invites_token ON role_invites(token);
CREATE INDEX IF NOT EXISTS idx_role_invites_role ON role_invites(role_id);

-- ─── Role people: 1st degree talent for a specific role ──────────────────────
CREATE TABLE IF NOT EXISTS role_people (
    id              SERIAL PRIMARY KEY,
    role_id         INTEGER NOT NULL REFERENCES roles(id),
    person_id       INTEGER NOT NULL REFERENCES people(id),
    recommender_id  INTEGER NOT NULL REFERENCES people(id),
    submission_id   INTEGER REFERENCES submissions(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (role_id, person_id, recommender_id)
);

CREATE INDEX IF NOT EXISTS idx_role_people_role ON role_people(role_id);

-- ─── Schema updates: expand CHECK constraints ───────────────────────────────

-- Allow 'role_vouch' as a submission form_type
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_form_type_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_form_type_check
    CHECK (form_type IN ('network', 'vouch', 'role_vouch'));

-- Allow 'role_network' and 'role_ready' as sent_emails types
ALTER TABLE sent_emails DROP CONSTRAINT IF EXISTS sent_emails_email_type_check;
ALTER TABLE sent_emails ADD CONSTRAINT sent_emails_email_type_check
    CHECK (email_type IN (
        'talent_ready', 'login_link', 'you_were_vouched', 'please_vouch',
        'role_network', 'role_ready'
    ));

-- One role_ready email per role per person
CREATE UNIQUE INDEX IF NOT EXISTS idx_sent_emails_role_ready_unique
    ON sent_emails(recipient_id, email_type, reference_id)
    WHERE email_type = 'role_ready';

-- ─── Seed email templates ────────────────────────────────────────────────────

INSERT INTO email_templates (template_key, subject, body_html, available_vars) VALUES (
    'role_network',
    '{{inviterFirstName}} needs talent recommendations for a specific role',
    '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{firstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      <strong>{{inviterFirstName}}</strong> is looking for talent for a specific role and
      would love your recommendations:
    </p>
    <div style="margin:0 0 16px;padding:12px 16px;background:#F8F4E8;border-radius:8px;border:1px solid #E7E5E0;">
      <div style="font-size:15px;font-weight:600;color:#1C1917;">{{jobFunction}}</div>
      <div style="font-size:13px;color:#78716C;margin-top:2px;">{{level}}</div>
      {{specialSkillsHtml}}
    </div>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 4px;">
      Who are the best people you know for this role? Share up to 4 recommendations:
    </p>
    <div style="margin:24px 0;">
      <a href="{{vouchUrl}}" style="display:inline-block;padding:12px 28px;background:#2563EB;color:#FFFFFF;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">Share Recommendations</a>
    </div>
    <p style="font-size:13px;color:#78716C;line-height:1.5;margin:0;">
      Your recommendations will be anonymous — {{inviterFirstName}} will see who was recommended
      but not who specifically recommended them.
    </p>',
    'firstName,inviterFirstName,jobFunction,level,specialSkillsHtml,vouchUrl'
) ON CONFLICT (template_key) DO NOTHING;

INSERT INTO email_templates (template_key, subject, body_html, available_vars) VALUES (
    'role_ready',
    'Your role-specific talent recommendations are ready',
    '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{firstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      Great news — enough recommenders have shared their talent picks for your
      <strong>{{jobFunction}}</strong> ({{level}}) search that your results are ready.
    </p>
    <div style="margin:24px 0;">
      <a href="{{roleUrl}}" style="display:inline-block;padding:12px 28px;background:#2563EB;color:#FFFFFF;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">View Recommendations</a>
    </div>
    <p style="font-size:13px;color:#78716C;line-height:1.5;margin:0;">
      This link is unique to you and expires in 7 days.
    </p>',
    'firstName,jobFunction,level,roleUrl'
) ON CONFLICT (template_key) DO NOTHING;
