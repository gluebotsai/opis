-- Durable CRM agent memory (structured slots for coworker LTM).

CREATE TABLE IF NOT EXISTS agent_memories (
  id TEXT PRIMARY KEY,
  organization_id UUID NOT NULL,
  scope_type VARCHAR(16) NOT NULL,
  scope_id VARCHAR(64) NOT NULL DEFAULT '',
  slot_key VARCHAR(64) NOT NULL,
  slot_value JSONB NOT NULL,
  source VARCHAR(32),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_memories_scope_slot_uidx
  ON agent_memories (organization_id, scope_type, scope_id, slot_key);

CREATE INDEX IF NOT EXISTS agent_memories_scope_idx
  ON agent_memories (organization_id, scope_type, scope_id);

CREATE INDEX IF NOT EXISTS agent_memories_updated_idx
  ON agent_memories (organization_id, updated_at DESC);
