-- WhatsApp bot policy + email bot inactivity close window.

ALTER TABLE ccass.email_mailbox_policies
  ADD COLUMN IF NOT EXISTS inactivity_close_hours INT NOT NULL DEFAULT 72
    CHECK (inactivity_close_hours >= 1 AND inactivity_close_hours <= 720);

CREATE TABLE IF NOT EXISTS ccass.whatsapp_channel_policies (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  channel_config_id BIGINT NOT NULL,
  bot_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  live_agent_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  confidence_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.500
    CHECK (confidence_threshold >= 0 AND confidence_threshold <= 1),
  default_queue_id BIGINT REFERENCES ccass.queues(id) ON DELETE SET NULL,
  approved_handoff_message TEXT,
  inactivity_close_hours INT NOT NULL DEFAULT 24
    CHECK (inactivity_close_hours >= 1 AND inactivity_close_hours <= 720),
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_whatsapp_channel_policy_config_key
    UNIQUE (organization_id, channel_config_id)
);

CREATE INDEX IF NOT EXISTS idx_ccass_whatsapp_channel_policies_org_status
  ON ccass.whatsapp_channel_policies (organization_id, status);

-- Extracted knowledge document text (accounts schema).
CREATE TABLE IF NOT EXISTS accounts.setup_knowledge_document_texts (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  document_id BIGINT NOT NULL UNIQUE REFERENCES accounts.setup_knowledge_documents(id) ON DELETE CASCADE,
  extracted_text TEXT NOT NULL DEFAULT '',
  token_estimate INT NOT NULL DEFAULT 0,
  extraction_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_setup_knowledge_document_texts_org
  ON accounts.setup_knowledge_document_texts (organization_id);
