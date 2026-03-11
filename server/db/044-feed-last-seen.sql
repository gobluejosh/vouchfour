-- VouchFour Migration 044: Add feed_last_seen_at to people
-- Tracks when the user last saw their feed (via Brain welcome message).
-- Feed items older than this timestamp won't resurface in the greeting.

ALTER TABLE people ADD COLUMN IF NOT EXISTS feed_last_seen_at TIMESTAMPTZ;
