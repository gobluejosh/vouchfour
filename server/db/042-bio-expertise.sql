-- VouchFour Migration 042: Add 'bio' chunk_type to person_expertise
-- Bio interview facts flow through expertise/embeddings for Brain-only semantic access.
-- Bio chunks are NEVER passed to generateSummary for public AI profiles.
-- Run: psql -d vouchfour -f server/db/042-bio-expertise.sql

-- Drop and recreate the CHECK constraint to include 'bio'
ALTER TABLE person_expertise
  DROP CONSTRAINT IF EXISTS person_expertise_chunk_type_check;

ALTER TABLE person_expertise
  ADD CONSTRAINT person_expertise_chunk_type_check CHECK (chunk_type IN (
    'trajectory_summary',
    'transition',
    'scaling',
    'topic',
    'functional',
    'environment',
    'bio'              -- first-person career context from /bio interview (private, Brain-only)
  ));
