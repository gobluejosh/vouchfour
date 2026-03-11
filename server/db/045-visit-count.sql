-- VouchFour Migration 045: Add visit_count to people
-- Tracks how many times the Brain welcome message has fired for a user.
-- Used to show progressive onboarding nudges on visits 2-4.

ALTER TABLE people ADD COLUMN IF NOT EXISTS visit_count INTEGER NOT NULL DEFAULT 0;
