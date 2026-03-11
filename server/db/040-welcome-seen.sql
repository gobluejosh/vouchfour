-- Track when a user has completed the onboarding welcome tour
-- Used to distinguish first visit (scenario A) from returning-no-vouch (scenario B)
ALTER TABLE people ADD COLUMN IF NOT EXISTS welcome_seen_at TIMESTAMPTZ;
