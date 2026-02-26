-- VouchFour Migration 008: Add Legal job function
-- Run: psql -d vouchfour -f server/db/008-add-legal.sql

INSERT INTO job_functions (name, slug, display_order, practitioner_label) VALUES
    ('Legal', 'legal', 13, 'Lawyers')
ON CONFLICT (slug) DO NOTHING;
