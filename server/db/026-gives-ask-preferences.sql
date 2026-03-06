-- 026: Gives & Ask Preferences
-- Adds user preference columns for controlling who can send asks
-- and what the user is willing to give to their network.

ALTER TABLE people
  ADD COLUMN IF NOT EXISTS ask_receive_degree TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gives TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS gives_free_text TEXT DEFAULT NULL;

-- ask_receive_degree values: 'network' (1-3°), '2nd' (1-2°), '1st', 'none'
-- NULL means use default: has_vouched → 'network', otherwise → '1st'
