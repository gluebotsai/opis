-- Enterprise email bot policy, durable provider processing, and NLP audit extensions.
-- Additive and backward-compatible: bot/auto-send default off.

CREATE TABLE IF NOT EXISTS accounts.setup_queue_routing_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  queue_id UUID NOT NULL UNIQUE REFERENCES accounts.setup_ccaas_queues(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  supported_intents JSONB NOT NULL DEFAULT '[]'::jsonb,
  example_phrases JSONB NOT NULL DEFAULT '[]'::jsonb,
  language_codes JSONB NOT NULL DEFAULT '["en"]'::jsonb,
  skill_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  classifier_version VARCHAR(64) NOT NULL DEFAULT 'v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ccass.email_mailbox_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL,
  account_email VARCHAR(255) NOT NULL,
  bot_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  live_agent_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  shadow_mode BOOLEAN NOT NULL DEFAULT TRUE,
  auto_send_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  confidence_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.850
    CHECK (confidence_threshold >= 0 AND confidence_threshold <= 1),
  default_queue_id UUID REFERENCES ccass.queues(id) ON DELETE SET NULL,
  allowed_queue_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_service_message TEXT,
  business_hours_mode VARCHAR(32) NOT NULL DEFAULT 'queue_policy',
  policy_version INT NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_email_mailbox_policy_connection_key
    UNIQUE (organization_id, connection_id),
  CONSTRAINT ccass_email_mailbox_policy_email_key
    UNIQUE (organization_id, account_email)
);

CREATE INDEX IF NOT EXISTS idx_ccass_email_mailbox_policies_org_status
  ON ccass.email_mailbox_policies (organization_id, status);

CREATE TABLE IF NOT EXISTS ccass.email_provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  connection_id UUID,
  provider VARCHAR(32) NOT NULL DEFAULT 'gmail',
  event_id VARCHAR(255) NOT NULL,
  mailbox_email VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'processing',
  attempt_count INT NOT NULL DEFAULT 1,
  last_error TEXT,
  processing_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_email_provider_events_org_provider_event_key
    UNIQUE (organization_id, provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_ccass_email_provider_events_status
  ON ccass.email_provider_events (status, updated_at);

CREATE TABLE IF NOT EXISTS ccass.email_delivery_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL UNIQUE REFERENCES ccass.conversation_messages(id) ON DELETE CASCADE,
  source_message_id UUID NOT NULL REFERENCES ccass.conversation_messages(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL,
  recipient_email VARCHAR(320) NOT NULL,
  subject VARCHAR(512) NOT NULL,
  provider_thread_id VARCHAR(255),
  in_reply_to VARCHAR(998),
  references_header TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_message_id VARCHAR(255),
  provider_rfc_message_id VARCHAR(998),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ccass_email_delivery_outbox_source
  ON ccass.email_delivery_outbox (organization_id, source_message_id);

CREATE INDEX IF NOT EXISTS idx_ccass_email_delivery_outbox_pending
  ON ccass.email_delivery_outbox (status, next_attempt_at)
  WHERE status IN ('pending', 'retry');

ALTER TABLE ccass.conversations
  ADD COLUMN IF NOT EXISTS mailbox_connection_id UUID,
  ADD COLUMN IF NOT EXISTS automation_policy_version INT,
  ADD COLUMN IF NOT EXISTS first_response_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_agent_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_status VARCHAR(32) NOT NULL DEFAULT 'not_started';

ALTER TABLE ccass.routing_policies
  ADD COLUMN IF NOT EXISTS email_offer_timeout_seconds INT NOT NULL DEFAULT 3600,
  ADD COLUMN IF NOT EXISTS email_first_response_sla_seconds INT NOT NULL DEFAULT 14400,
  ADD COLUMN IF NOT EXISTS email_resolution_sla_seconds INT NOT NULL DEFAULT 86400,
  ADD COLUMN IF NOT EXISTS email_after_contact_work_seconds INT NOT NULL DEFAULT 0;

ALTER TABLE ccass.conversation_messages
  ADD COLUMN IF NOT EXISTS rfc_message_id VARCHAR(998),
  ADD COLUMN IF NOT EXISTS in_reply_to VARCHAR(998),
  ADD COLUMN IF NOT EXISTS references_header TEXT,
  ADD COLUMN IF NOT EXISTS provider_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_headers JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ccass_conversation_messages_rfc_message_id
  ON ccass.conversation_messages (organization_id, rfc_message_id)
  WHERE rfc_message_id IS NOT NULL;

ALTER TABLE ccass.nlp_turns
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS sentiment VARCHAR(50),
  ADD COLUMN IF NOT EXISTS important_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS selected_queue_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS queue_profile_version VARCHAR(64),
  ADD COLUMN IF NOT EXISTS grounded BOOLEAN,
  ADD COLUMN IF NOT EXISTS guard_passed BOOLEAN,
  ADD COLUMN IF NOT EXISTS guard_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS knowledge_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS delivery_message_id UUID;
