-- VouchFour Migration 007: Add Executive & Investor job functions, reorder display
-- Run: psql -d vouchfour -f server/db/007-add-job-functions.sql

-- ─── Add new job functions ───────────────────────────────────────────────────
INSERT INTO job_functions (name, slug, display_order, practitioner_label) VALUES
    ('Executive', 'executive', 11, 'Executives'),
    ('Investor', 'investor', 12, 'Investors')
ON CONFLICT (slug) DO NOTHING;

-- ─── Reorder all job functions ───────────────────────────────────────────────
UPDATE job_functions SET display_order = CASE id
    WHEN  1 THEN  1   -- Engineering / Software Development
    WHEN  2 THEN  2   -- Product Management
    WHEN  3 THEN  3   -- Marketing
    WHEN  4 THEN  6   -- Sales
    WHEN  5 THEN  5   -- Design (Product/UX)
    WHEN  6 THEN  4   -- Data / Analytics
    WHEN  7 THEN  8   -- Finance / Accounting
    WHEN  8 THEN  9   -- Operations
    WHEN  9 THEN 10   -- People / HR
    WHEN 10 THEN  7   -- Customer Success
    WHEN 11 THEN 11   -- Executive
    WHEN 12 THEN 12   -- Investor
END;
