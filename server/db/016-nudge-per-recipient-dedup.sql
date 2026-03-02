-- VouchFour Migration 016: One nudge per person (not per invite)
-- Ensures each person only ever receives one nudge_1 and one nudge_2,
-- even if they were invited by multiple people.
-- Run: psql -d vouchfour -f server/db/016-nudge-per-recipient-dedup.sql

-- ─── Drop old per-invite unique indexes ────────────────────────────────
DROP INDEX IF EXISTS idx_sent_emails_nudge1_unique;
DROP INDEX IF EXISTS idx_sent_emails_nudge2_unique;

-- ─── New per-recipient unique indexes: one nudge_1/nudge_2 per person ever
CREATE UNIQUE INDEX idx_sent_emails_nudge1_per_recipient
    ON sent_emails(recipient_id)
    WHERE email_type = 'nudge_1';

CREATE UNIQUE INDEX idx_sent_emails_nudge2_per_recipient
    ON sent_emails(recipient_id)
    WHERE email_type = 'nudge_2';
