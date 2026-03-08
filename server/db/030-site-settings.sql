-- VouchFour Migration 030: Site Settings
-- Run: psql -d vouchfour -f server/db/030-site-settings.sql

CREATE TABLE IF NOT EXISTS site_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed brain starter questions
INSERT INTO site_settings (key, value) VALUES (
    'brain_starters',
    '["Who has startup founding experience?", "Who are the strongest engineers?", "Who should I get to know better?"]'::jsonb
) ON CONFLICT (key) DO NOTHING;
