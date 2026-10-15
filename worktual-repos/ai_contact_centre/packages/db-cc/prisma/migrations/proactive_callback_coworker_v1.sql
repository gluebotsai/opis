-- Proactive missed-callback coworker: per-queue grace + attempt audit.

ALTER TABLE accounts.setup_ccaas_queues
  ADD COLUMN IF NOT EXISTS missed_callback_grace_minutes INT;

ALTER TABLE ccass.routing_policies
  ADD COLUMN IF NOT EXISTS missed_callback_grace_minutes INT;

COMMENT ON COLUMN accounts.setup_ccaas_queues.missed_callback_grace_minutes IS
  'NULL=Off, 0=Immediate, 5/10/15/30 minutes after miss before coworker auto-assigns callback';

COMMENT ON COLUMN ccass.routing_policies.missed_callback_grace_minutes IS
  'Published copy of setup queue proactive callback grace setting';

CREATE TABLE IF NOT EXISTS ccass.proactive_callback_attempts (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  missed_contact_id BIGINT NOT NULL UNIQUE,
  queue_id BIGINT,
  conversation_id BIGINT,
  contact_id BIGINT,
  status VARCHAR(32) NOT NULL DEFAULT 'planned',
  task_id BIGINT,
  plan_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proactive_callback_attempts_org_status
  ON ccass.proactive_callback_attempts (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_proactive_callback_attempts_org_ack
  ON ccass.proactive_callback_attempts (organization_id, acknowledged_at, created_at DESC)
  WHERE acknowledged_at IS NULL AND status = 'assigned';
