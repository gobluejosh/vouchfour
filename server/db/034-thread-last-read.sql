-- VouchFour Migration 034: Track when participants last read a thread
-- Used to highlight threads with new activity on the profile page.

ALTER TABLE thread_participants
    ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;
