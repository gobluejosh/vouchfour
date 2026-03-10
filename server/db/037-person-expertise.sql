-- VouchFour Migration 037: Person expertise chunks
-- Structured expertise signals derived from enrichment data.
-- Used for semantic search (future: pgvector embeddings) and Brain v2 context.
-- Run: psql -d vouchfour -f server/db/037-person-expertise.sql

CREATE TABLE IF NOT EXISTS person_expertise (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  chunk_type TEXT NOT NULL CHECK (chunk_type IN (
    'trajectory_summary',  -- overall career narrative optimized for matching
    'transition',          -- specific career transition (IC→mgr, startup→bigco, etc.)
    'scaling',             -- scaling moment (team growth, company growth stage)
    'topic',               -- topic expertise from content (blogs, podcasts, talks)
    'functional',          -- functional depth signal (years, breadth, vouch context)
    'environment'          -- environment type (startup, enterprise, specific domain)
  )),
  chunk_text TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_person_expertise_person_id ON person_expertise(person_id);
CREATE INDEX IF NOT EXISTS idx_person_expertise_chunk_type ON person_expertise(chunk_type);
CREATE INDEX IF NOT EXISTS idx_person_expertise_tags ON person_expertise USING GIN(tags);

-- Prevent duplicate chunks for same person
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_expertise_unique
  ON person_expertise(person_id, chunk_type, md5(chunk_text));
