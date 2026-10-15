-- Missed contact notifications when an agent does not answer a ringing offer.

CREATE TABLE IF NOT EXISTS ccass.agent_missed_contacts (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  agent_id BIGINT NOT NULL,
  assigned_user_id BIGINT NOT NULL,
  conversation_id BIGINT NOT NULL,
  assignment_id BIGINT,
  contact_id BIGINT,
  queue_id BIGINT,
  channel VARCHAR(32) NOT NULL,
  reason VARCHAR(32) NOT NULL DEFAULT 'offer_timeout',
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  offered_at TIMESTAMPTZ,
  missed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_missed_contacts_reason_check CHECK (reason IN ('offer_timeout', 'manual_reject'))
);

CREATE INDEX IF NOT EXISTS idx_agent_missed_contacts_org_user_ack
  ON ccass.agent_missed_contacts (organization_id, assigned_user_id, acknowledged_at, missed_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_missed_contacts_org_agent_missed
  ON ccass.agent_missed_contacts (organization_id, agent_id, missed_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_missed_contacts_org_conversation
  ON ccass.agent_missed_contacts (organization_id, conversation_id);
