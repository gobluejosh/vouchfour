-- VouchFour Migration 022: Enrichment review queue
-- Adds review_status, review_notes, reviewed_at to people table.
-- Existing people default to 'approved' (already reviewed via static tool).
-- New enrichments set review_status = 'pending' via enrichPerson().
-- Run: psql -d vouchfour -f server/db/022-enrichment-review.sql

ALTER TABLE people ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'pending'
  CHECK (review_status IN ('pending', 'approved', 'flagged'));
ALTER TABLE people ADD COLUMN IF NOT EXISTS review_notes TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Mark all existing enriched people as approved (already manually reviewed)
UPDATE people SET review_status = 'approved', reviewed_at = NOW()
WHERE enriched_at IS NOT NULL AND review_status = 'pending';
