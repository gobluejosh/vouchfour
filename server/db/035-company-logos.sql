-- Company logo cache (lazy-fetched from logo.dev + favicon fallback)
CREATE TABLE IF NOT EXISTS company_logos (
  domain TEXT PRIMARY KEY,
  image_data BYTEA,
  content_type TEXT DEFAULT 'image/png',
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);
