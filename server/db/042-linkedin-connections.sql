-- LinkedIn Connections import tables
-- Stores LinkedIn connections uploaded by users, separate from the people table.
-- Private to the uploader — used to enhance MCP search results.

CREATE TABLE linkedin_connections (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES people(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  display_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
  email TEXT,
  company TEXT,
  title TEXT,
  linkedin_url TEXT,
  connected_on DATE,
  matched_person_id INTEGER REFERENCES people(id),
  enriched_at TIMESTAMPTZ,
  ai_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lc_owner ON linkedin_connections(owner_id);
CREATE INDEX idx_lc_linkedin_url ON linkedin_connections(linkedin_url);
CREATE UNIQUE INDEX idx_lc_owner_linkedin ON linkedin_connections(owner_id, linkedin_url) WHERE linkedin_url IS NOT NULL;

CREATE TABLE linkedin_connection_embeddings (
  id SERIAL PRIMARY KEY,
  connection_id INTEGER NOT NULL REFERENCES linkedin_connections(id) ON DELETE CASCADE,
  source_text TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lce_vector ON linkedin_connection_embeddings
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_lce_connection ON linkedin_connection_embeddings(connection_id);
