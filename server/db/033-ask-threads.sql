-- VouchFour Migration 033: Link Quick Asks to Threads
-- When an ask is sent, a 2-person thread is created alongside it.
-- This column links the ask recipient row to its conversation thread.

ALTER TABLE quick_ask_recipients
    ADD COLUMN IF NOT EXISTS thread_id INTEGER REFERENCES threads(id);

CREATE INDEX IF NOT EXISTS idx_quick_ask_recipients_thread
    ON quick_ask_recipients(thread_id);
