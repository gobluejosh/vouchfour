-- 027: Career History Editor Support
-- Adds location and description to employment_history for richer role data.
-- Adds career_edited_at to people to prevent Apollo from overwriting user edits.

ALTER TABLE employment_history
  ADD COLUMN IF NOT EXISTS location TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT NULL;

ALTER TABLE people
  ADD COLUMN IF NOT EXISTS career_edited_at TIMESTAMPTZ DEFAULT NULL;
