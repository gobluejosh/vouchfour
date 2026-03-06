-- 025: Email-free vouch mode
-- Adds share_token to people (one per voucher, reusable across submissions)
-- and vouch_collect_email admin setting

-- Share token: one per voucher, reusable across all their submissions
ALTER TABLE people ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_people_share_token ON people(share_token);

-- Admin setting (default: current email-collection behavior)
INSERT INTO app_settings (key, value) VALUES ('vouch_collect_email', 'true')
ON CONFLICT (key) DO NOTHING;
