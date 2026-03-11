-- VouchFour Migration 043: Add 'visited' status to vouch_invites
-- Enables 3-state invite funnel: pending → visited → vouched
-- 'visited' is set when an invitee logs in (via /api/auth/validate)
-- Run: psql -d vouchfour -f server/db/043-visited-status.sql

-- Drop and recreate the CHECK constraint to include 'visited'
ALTER TABLE vouch_invites
  DROP CONSTRAINT IF EXISTS vouch_invites_status_check;

ALTER TABLE vouch_invites
  ADD CONSTRAINT vouch_invites_status_check CHECK (status IN (
    'pending',
    'visited',     -- invitee has logged in but not yet vouched
    'completed',
    'expired'
  ));
