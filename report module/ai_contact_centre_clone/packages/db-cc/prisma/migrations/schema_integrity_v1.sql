-- Schema integrity constraints and hot-path indexes (Step 3).

-- Contact interaction lookup index
CREATE INDEX IF NOT EXISTS idx_conversations_org_contact
  ON ccass.conversations (organization_id, contact_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_org_channel_status
  ON ccass.conversations (organization_id, channel, status);

CREATE INDEX IF NOT EXISTS idx_conversations_channel_config
  ON ccass.conversations (channel_config_id)
  WHERE channel_config_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nlp_turns_conversation
  ON ccass.nlp_turns (nlp_conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv_created
  ON ccass.conversation_messages (conversation_id, created_at ASC);

-- CDP contact identity lookup
CREATE INDEX IF NOT EXISTS idx_contact_identities_lookup
  ON cdp.contact_identities (organization_id, identity_type, identity_value);

-- Status/lifecycle consistency check (soft — only on new rows via trigger would be ideal;
-- for now add a CHECK that rejects impossible combinations)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_conversations_status_lifecycle'
      AND conrelid = 'ccass.conversations'::regclass
  ) THEN
    ALTER TABLE ccass.conversations
      ADD CONSTRAINT chk_conversations_status_lifecycle CHECK (
        (status = 'bot_active' AND lifecycle_state IN ('bot', 'waiting'))
        OR (status = 'queued' AND lifecycle_state IN ('waiting', 'bot'))
        OR (status = 'assigned' AND lifecycle_state IN ('offered', 'waiting'))
        OR (status = 'active' AND lifecycle_state IN ('connected', 'offered'))
        OR (status IN ('resolved', 'closed') AND lifecycle_state = 'ended')
        OR lifecycle_state IS NULL
      );
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'ccass.conversations not found, skipping lifecycle check';
  WHEN check_violation THEN
    RAISE NOTICE 'Existing data violates lifecycle check, constraint not added';
END $$;

-- Non-negative capacity counters
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'ccass' AND table_name = 'agent_capacity') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_capacity_non_negative'
    ) THEN
      ALTER TABLE ccass.agent_capacity
        ADD CONSTRAINT chk_agent_capacity_non_negative CHECK (max_concurrency >= 0 AND active_count >= 0 AND reserved_count >= 0);
    END IF;
  END IF;
EXCEPTION
  WHEN check_violation THEN
    RAISE NOTICE 'Existing capacity data violates check, constraint not added';
END $$;
