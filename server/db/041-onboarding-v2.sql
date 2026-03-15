-- Track when a user has completed the onboarding v2 guided discovery flow
ALTER TABLE people ADD COLUMN IF NOT EXISTS onboarding_v2_at TIMESTAMPTZ;
