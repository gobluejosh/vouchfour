-- Bio interview: persists conversational career interview state across sessions
-- Used by /bio slash command in the Brain to walk users through their career history
CREATE TABLE IF NOT EXISTS bio_interviews (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id),
  status TEXT NOT NULL DEFAULT 'active',          -- active | paused | completed
  current_role_index INTEGER NOT NULL DEFAULT 0,  -- which role we're discussing (0-based into career history)
  turns JSONB NOT NULL DEFAULT '[]',              -- [{ role: 'user'|'assistant', content: text }]
  facts JSONB NOT NULL DEFAULT '[]',              -- confirmed facts: [{ role_index, type, text }]
  vouch_suggestions JSONB NOT NULL DEFAULT '[]',  -- [{ name, organization, context }]
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(person_id)                               -- one interview per person
);
