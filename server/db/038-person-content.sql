-- Migration 038: person_content table for discovered content
-- Stores extracted content from Medium, Substack, GitHub, podcasts, talks, etc.
-- Fed into expertise extraction for richer topic/skill signals.

CREATE TABLE IF NOT EXISTS person_content (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,

  -- Classification
  content_type TEXT NOT NULL CHECK (content_type IN (
    'blog_post',        -- Medium, Substack, personal blog articles
    'podcast',          -- Podcast episode appearances
    'conference_talk',  -- Conference/event speaking appearances
    'video',            -- YouTube or other video appearances
    'github_profile',   -- GitHub profile summary (repos, languages, stars)
    'github_repo'       -- Individual notable GitHub repo
  )),

  -- Source
  source_url TEXT,                  -- Original URL where we found this
  source_platform TEXT,             -- 'medium', 'substack', 'github', 'youtube', 'podcast', 'other'
  discovered_via TEXT DEFAULT 'brave',  -- How we found it: 'brave', 'rss', 'api'

  -- Extracted content
  title TEXT,
  content_summary TEXT,             -- Claude-extracted summary of what this content is about
  topics TEXT[] DEFAULT '{}',       -- Extracted topic tags
  raw_metadata JSONB DEFAULT '{}', -- Platform-specific data (repo stars, languages, episode number, etc.)

  -- Dedup
  content_hash TEXT,                -- md5 of title+url for dedup

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_person_content_person ON person_content(person_id);
CREATE INDEX IF NOT EXISTS idx_person_content_type ON person_content(content_type);
CREATE INDEX IF NOT EXISTS idx_person_content_topics ON person_content USING GIN(topics);
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_content_dedup
  ON person_content(person_id, content_type, content_hash);
