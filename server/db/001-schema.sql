-- VouchFour Schema
-- Run: psql -d vouchfour -f server/db/001-schema.sql

-- ─── People: graph nodes ─────────────────────────────────────────────────────
-- Every person who appears in any form gets a row.
-- LinkedIn URL is the canonical unique identifier.
CREATE TABLE IF NOT EXISTS people (
    id              SERIAL PRIMARY KEY,
    linkedin_url    TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    email           TEXT,
    self_provided   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Submissions: audit trail ────────────────────────────────────────────────
-- Records each form submission for debugging and re-processing.
CREATE TABLE IF NOT EXISTS submissions (
    id              SERIAL PRIMARY KEY,
    submitter_id    INTEGER NOT NULL REFERENCES people(id),
    form_type       TEXT NOT NULL CHECK (form_type IN ('network', 'vouch')),
    submitted_at    TIMESTAMPTZ,
    raw_payload     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Edges: graph relationships ──────────────────────────────────────────────
-- Two types: 'network' (connector) and 'vouch' (talent recommendation).
-- Directional: source listed target in their form.
CREATE TABLE IF NOT EXISTS edges (
    id              SERIAL PRIMARY KEY,
    source_id       INTEGER NOT NULL REFERENCES people(id),
    target_id       INTEGER NOT NULL REFERENCES people(id),
    edge_type       TEXT NOT NULL CHECK (edge_type IN ('network', 'vouch')),
    submission_id   INTEGER REFERENCES submissions(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_id, target_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_edges_source_type ON edges(source_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_edges_target_type ON edges(target_id, edge_type);

-- ─── Vouch invites: token-based vouch invitations ────────────────────────────
-- When User A submits a Network form, a vouch invite is created for each
-- connector with a unique token. The connector visits /vouch?token=abc123.
CREATE TABLE IF NOT EXISTS vouch_invites (
    id              SERIAL PRIMARY KEY,
    token           TEXT NOT NULL UNIQUE,
    inviter_id      INTEGER NOT NULL REFERENCES people(id),
    invitee_id      INTEGER NOT NULL REFERENCES people(id),
    submission_id   INTEGER REFERENCES submissions(id),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'completed', 'expired')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vouch_invites_token ON vouch_invites(token);

-- ─── Degree coefficients: admin-adjustable scoring ───────────────────────────
-- vouch_score = degree_coefficient[degree] * recommendation_count
CREATE TABLE IF NOT EXISTS degree_coefficients (
    degree      INTEGER PRIMARY KEY CHECK (degree BETWEEN 1 AND 3),
    coefficient NUMERIC(5,3) NOT NULL DEFAULT 1.000
);

-- Seed default coefficients
INSERT INTO degree_coefficients (degree, coefficient) VALUES
    (1, 1.000),
    (2, 0.500),
    (3, 0.250)
ON CONFLICT (degree) DO NOTHING;
