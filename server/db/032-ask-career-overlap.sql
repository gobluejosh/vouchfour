-- VouchFour Migration 032: Ask Career Overlap Permission
-- Run: psql -d vouchfour -f server/db/032-ask-career-overlap.sql

-- Allow former colleagues (career overlap) to send Asks, regardless of network degree
ALTER TABLE people ADD COLUMN IF NOT EXISTS ask_allow_career_overlap BOOLEAN NOT NULL DEFAULT true;
