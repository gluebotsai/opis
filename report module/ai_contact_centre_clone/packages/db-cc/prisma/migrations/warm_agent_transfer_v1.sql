-- Durable, explicit warm agent-to-agent transfer lifecycle.
-- Queue-only transfers keep their legacy requested/queued states.

ALTER TABLE ccass.conversation_transfers
  ADD COLUMN IF NOT EXISTS accepted_agent_id BIGINT REFERENCES ccass.agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outcome_reason VARCHAR(128),
  ADD COLUMN IF NOT EXISTS channel VARCHAR(32);

ALTER TABLE ccass.conversation_dispositions
  ADD COLUMN IF NOT EXISTS transfer_id BIGINT REFERENCES ccass.conversation_transfers(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'ccass'
      AND indexname = 'uq_ccass_conversation_transfers_open_explicit'
  ) AND NOT EXISTS (
    SELECT 1
    FROM ccass.conversation_transfers
    WHERE requested_agent_id IS NOT NULL
      AND state = 'offered'
    GROUP BY organization_id, conversation_id
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX uq_ccass_conversation_transfers_open_explicit
      ON ccass.conversation_transfers (organization_id, conversation_id)
      WHERE requested_agent_id IS NOT NULL
        AND state = 'offered';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ccass_conversation_transfers_state'
      AND conrelid = 'ccass.conversation_transfers'::regclass
  ) THEN
    ALTER TABLE ccass.conversation_transfers
      ADD CONSTRAINT chk_ccass_conversation_transfers_state
      CHECK (
        state IN (
          'requested', 'queued', 'offered', 'accepted', 'completed',
          'rejected', 'expired', 'cancelled'
        )
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ccass_conversation_transfers_accepted_agent
  ON ccass.conversation_transfers (
    organization_id,
    accepted_agent_id,
    accepted_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_ccass_conversation_dispositions_transfer
  ON ccass.conversation_dispositions (organization_id, transfer_id)
  WHERE transfer_id IS NOT NULL;
