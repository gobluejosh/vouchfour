-- Migration 039: person_embeddings table for semantic search
-- Requires pgvector extension (CREATE EXTENSION vector)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS person_embeddings (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  expertise_id INTEGER REFERENCES person_expertise(id) ON DELETE CASCADE,
  content_id INTEGER REFERENCES person_content(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('expertise', 'content')),
  source_text TEXT NOT NULL,              -- The text that was embedded (for debugging)
  embedding vector(1536) NOT NULL,        -- OpenAI text-embedding-3-small vector
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_person_embeddings_person ON person_embeddings(person_id);
CREATE INDEX IF NOT EXISTS idx_person_embeddings_source ON person_embeddings(source_type);

-- Unique constraint: one embedding per expertise chunk or content item
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_embeddings_expertise
  ON person_embeddings(expertise_id) WHERE expertise_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_embeddings_content
  ON person_embeddings(content_id) WHERE content_id IS NOT NULL;

-- Vector similarity index (cosine distance) — HNSW for fast approximate search
CREATE INDEX IF NOT EXISTS idx_person_embeddings_vector
  ON person_embeddings USING hnsw (embedding vector_cosine_ops);
