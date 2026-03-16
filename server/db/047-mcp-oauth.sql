-- Migration 047: MCP OAuth tables
-- Supports OAuth 2.1 Authorization Code + PKCE flow for MCP connector

-- OAuth authorization codes (short-lived, exchanged for tokens)
CREATE TABLE IF NOT EXISTS oauth_codes (
  id              SERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  person_id       INTEGER NOT NULL REFERENCES people(id),
  client_id       TEXT NOT NULL,
  redirect_uri    TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,
  scope           TEXT DEFAULT 'network:read',
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_code ON oauth_codes(code);

-- OAuth access tokens (long-lived, used by MCP client)
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id              SERIAL PRIMARY KEY,
  token           TEXT NOT NULL UNIQUE,
  person_id       INTEGER NOT NULL REFERENCES people(id),
  client_id       TEXT NOT NULL,
  scope           TEXT DEFAULT 'network:read',
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_token ON oauth_tokens(token);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_person ON oauth_tokens(person_id);
