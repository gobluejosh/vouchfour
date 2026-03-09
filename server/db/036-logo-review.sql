-- VouchFour Migration 036: Logo review queue
-- Adds review_status + source_name to company_logos table.
-- Existing logos default to 'pending' for review.
-- Run: psql -d vouchfour -f server/db/036-logo-review.sql

ALTER TABLE company_logos ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'pending'
  CHECK (review_status IN ('pending', 'approved', 'flagged'));
ALTER TABLE company_logos ADD COLUMN IF NOT EXISTS source_name TEXT;
