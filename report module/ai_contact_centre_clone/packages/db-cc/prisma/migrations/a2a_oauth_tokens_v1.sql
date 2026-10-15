-- Persist Hub/workload access tokens issued by the Contact Centre A2A spoke.

CREATE TABLE IF NOT EXISTS ccass.a2a_oauth_tokens (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  client_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  jti TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT a2a_oauth_tokens_jti_unique UNIQUE (jti),
  CONSTRAINT a2a_oauth_tokens_client_org_unique UNIQUE (client_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_a2a_oauth_tokens_org_client
  ON ccass.a2a_oauth_tokens (organization_id, client_id);
