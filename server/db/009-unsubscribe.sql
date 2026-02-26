-- VouchFour Migration 009: Add unsubscribe tracking
-- Run: psql -d vouchfour -f server/db/009-unsubscribe.sql

ALTER TABLE people ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ DEFAULT NULL;
