-- Store last LLM input fingerprints so cron sweeps skip unchanged entities.
CREATE TABLE IF NOT EXISTS crm.agent_input_fingerprints (
  id TEXT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  agent TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_llm_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_input_fingerprints_org_agent_entity_uidx
  ON crm.agent_input_fingerprints (organization_id, agent, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS agent_input_fingerprints_org_checked_idx
  ON crm.agent_input_fingerprints (organization_id, last_checked_at);
