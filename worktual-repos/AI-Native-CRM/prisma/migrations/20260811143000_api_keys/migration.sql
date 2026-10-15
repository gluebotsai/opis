-- Tenant integration API keys (admin-created; secret hashed).

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  organization_id UUID NOT NULL,
  name VARCHAR(120) NOT NULL,
  key_prefix VARCHAR(32) NOT NULL,
  key_hash VARCHAR(64) NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_org_prefix_uidx
  ON api_keys (organization_id, key_prefix);

CREATE INDEX IF NOT EXISTS api_keys_hash_idx
  ON api_keys (key_hash);

CREATE INDEX IF NOT EXISTS api_keys_org_revoked_idx
  ON api_keys (organization_id, revoked_at);
