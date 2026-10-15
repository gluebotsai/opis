-- Agent-initiated supervisor escalation after repeated Not Ready dismissals.

CREATE TABLE IF NOT EXISTS ccass.agent_not_ready_escalations (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  agent_id BIGINT NOT NULL,
  setup_user_id BIGINT,
  agent_name TEXT NOT NULL,
  escalated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_agent_not_ready_escalations_org_escalated
  ON ccass.agent_not_ready_escalations (organization_id, escalated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_not_ready_escalations_org_agent_escalated
  ON ccass.agent_not_ready_escalations (organization_id, agent_id, escalated_at DESC);
