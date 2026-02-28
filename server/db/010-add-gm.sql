-- VouchFour Migration 010: Add General Management job function
-- Run: psql -d vouchfour -f server/db/010-add-gm.sql

INSERT INTO job_functions (name, slug, display_order, practitioner_label) VALUES
    ('General Management', 'general-management', 14, 'General Managers')
ON CONFLICT (slug) DO NOTHING;
