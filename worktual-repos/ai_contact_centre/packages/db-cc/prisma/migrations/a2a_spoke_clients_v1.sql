-- Shared A2A spoke client registry (Hub ↔ product spokes).
-- Additive: older Hub DBs already have this table without organization_id
-- and with UNIQUE(a2a_server_name) / UNIQUE(client_id).
-- CCaaS reads/writes the worktual-hub row for outbound Hub delegation.

CREATE TABLE IF NOT EXISTS accounts.a2a_spoke_clients (
  id BIGSERIAL PRIMARY KEY,
  a2a_server_name TEXT NOT NULL,
  client_id TEXT NOT NULL,
  organization_id BIGINT,
  client_secret TEXT,
  access_token TEXT,
  access_expires_at TIMESTAMPTZ,
  refresh_token TEXT,
  refresh_expires_at TIMESTAMPTZ,
  skill_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE accounts.a2a_spoke_clients
  ADD COLUMN IF NOT EXISTS organization_id BIGINT,
  ADD COLUMN IF NOT EXISTS client_secret TEXT,
  ADD COLUMN IF NOT EXISTS access_token TEXT,
  ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS skill_version TEXT;

ALTER TABLE accounts.a2a_spoke_clients
  ALTER COLUMN client_secret DROP NOT NULL;

ALTER TABLE accounts.a2a_spoke_clients
  DROP CONSTRAINT IF EXISTS a2a_spoke_clients_server_unique,
  DROP CONSTRAINT IF EXISTS a2a_spoke_clients_client_unique;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'a2a_spoke_clients_server_client_unique'
  ) THEN
    ALTER TABLE accounts.a2a_spoke_clients
      ADD CONSTRAINT a2a_spoke_clients_server_client_unique
      UNIQUE (a2a_server_name, client_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_a2a_spoke_clients_org_server
  ON accounts.a2a_spoke_clients (organization_id, a2a_server_name);
