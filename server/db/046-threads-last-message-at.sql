-- Add last_message_at to threads for notification badge queries
ALTER TABLE threads ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

-- Backfill from latest thread_message per thread
UPDATE threads t SET last_message_at = sub.latest
FROM (
  SELECT thread_id, MAX(created_at) AS latest
  FROM thread_messages
  GROUP BY thread_id
) sub
WHERE t.id = sub.thread_id AND t.last_message_at IS NULL;
