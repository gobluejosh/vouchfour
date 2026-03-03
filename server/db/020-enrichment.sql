-- VouchFour Migration 020: Person enrichment pipeline
-- Adds enrichment fields to people, employment_history, and person_enrichment tables.
-- Run: psql -d vouchfour -f server/db/020-enrichment.sql

-- ── Extend people with top-line enrichment fields ──────────────────────
ALTER TABLE people ADD COLUMN IF NOT EXISTS current_title TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS current_company TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS seniority TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS headline TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;

-- ── Employment history ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employment_history (
    id              SERIAL PRIMARY KEY,
    person_id       INTEGER NOT NULL REFERENCES people(id),
    organization    TEXT NOT NULL,
    title           TEXT,
    start_date      DATE,
    end_date        DATE,
    is_current      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employment_history_person
    ON employment_history(person_id);
CREATE INDEX IF NOT EXISTS idx_employment_history_org
    ON employment_history(organization);

-- ── Person enrichment (raw payloads + AI summaries) ────────────────────
CREATE TABLE IF NOT EXISTS person_enrichment (
    id              SERIAL PRIMARY KEY,
    person_id       INTEGER NOT NULL REFERENCES people(id),
    source          TEXT NOT NULL CHECK (source IN ('apollo', 'brave', 'claude')),
    raw_payload     JSONB NOT NULL,
    ai_summary      TEXT,
    enriched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (person_id, source)
);

CREATE INDEX IF NOT EXISTS idx_person_enrichment_person
    ON person_enrichment(person_id);
