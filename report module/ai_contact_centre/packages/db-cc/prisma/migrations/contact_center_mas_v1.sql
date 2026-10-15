-- Additive audit and retrieval metadata for Contact Center MAS rollout.

ALTER TABLE ccass.copilot_skill_executions
  ADD COLUMN IF NOT EXISTS agent_name VARCHAR(128),
  ADD COLUMN IF NOT EXISTS agent_layer VARCHAR(32),
  ADD COLUMN IF NOT EXISTS server_key VARCHAR(128),
  ADD COLUMN IF NOT EXISTS argument_bytes INT,
  ADD COLUMN IF NOT EXISTS result_bytes INT,
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(32),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE ccass.copilot_turns
  ADD COLUMN IF NOT EXISTS routing_chain JSONB,
  ADD COLUMN IF NOT EXISTS prompt_versions JSONB,
  ADD COLUMN IF NOT EXISTS assist_state JSONB;

CREATE INDEX IF NOT EXISTS idx_ccass_copilot_memory_scope_updated
  ON ccass.copilot_memory (
    organization_id,
    user_id,
    memory_type,
    conversation_id,
    updated_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_ccass_copilot_skill_agent_created
  ON ccass.copilot_skill_executions (
    organization_id,
    agent_name,
    created_at DESC
  );

