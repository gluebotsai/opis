-- Durable, tenant-scoped idempotency and acknowledgement state for ACD
-- transfer actions. The application claims a pending row before publishing.

CREATE UNIQUE INDEX IF NOT EXISTS uq_ccass_conversation_transfers_org_id_conversation
  ON ccass.conversation_transfers (organization_id, id, conversation_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_setup_users_org_id
  ON accounts.setup_users (organization_id, id);

CREATE TABLE IF NOT EXISTS ccass.transfer_action_operations (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  operation_id VARCHAR(128) NOT NULL,
  conversation_id BIGINT NOT NULL,
  transfer_id BIGINT NOT NULL,
  requested_by_user_id BIGINT NOT NULL,
  acd_session_id VARCHAR(256) NOT NULL,
  action SMALLINT NOT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'pending',
  error_code VARCHAR(128),
  error_detail TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  terminal_at TIMESTAMPTZ,
  CONSTRAINT uq_ccass_transfer_action_operations_org_operation
    UNIQUE (organization_id, operation_id),
  CONSTRAINT fk_ccass_transfer_action_operations_tenant_transfer
    FOREIGN KEY (organization_id, transfer_id, conversation_id)
    REFERENCES ccass.conversation_transfers (organization_id, id, conversation_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ccass_transfer_action_operations_tenant_actor
    FOREIGN KEY (organization_id, requested_by_user_id)
    REFERENCES accounts.setup_users (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_ccass_transfer_action_operations_action
    CHECK (action IN (1, 2, 3, 4, 5, 6)),
  CONSTRAINT chk_ccass_transfer_action_operations_state
    CHECK (state IN ('pending', 'acknowledged', 'failed', 'timed_out'))
);

CREATE INDEX IF NOT EXISTS idx_ccass_transfer_action_operations_org_conversation
  ON ccass.transfer_action_operations (organization_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ccass_transfer_action_operations_org_transfer
  ON ccass.transfer_action_operations (organization_id, transfer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ccass_transfer_action_operations_pending
  ON ccass.transfer_action_operations (organization_id, created_at)
  WHERE state = 'pending';
