-- ccass operational conversation runtime, NLP bot/Copilot tables, routing, and presence.
-- Customer interaction projections belong in cdp — see cdp_interactions.sql.

-- Extend enterprise presence on existing table.
ALTER TABLE ccass.agent_presence
  ADD COLUMN IF NOT EXISTS presence_state VARCHAR(32) NOT NULL DEFAULT 'offline',
  ADD COLUMN IF NOT EXISTS reason_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'system';

CREATE TABLE IF NOT EXISTS ccass.presence_reason_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  code VARCHAR(64) NOT NULL,
  label VARCHAR(255) NOT NULL,
  presence_state VARCHAR(32) NOT NULL DEFAULT 'not_ready',
  requires_note BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_presence_reason_codes_org_code_key UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS ccass.agent_presence_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  agent_id UUID NOT NULL REFERENCES ccass.agents(id) ON DELETE CASCADE,
  previous_state VARCHAR(32),
  new_state VARCHAR(32) NOT NULL,
  reason_code VARCHAR(64),
  source VARCHAR(32) NOT NULL DEFAULT 'agent',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ccass_agent_presence_history_agent
  ON ccass.agent_presence_history (agent_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ccass.agent_capacity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  agent_id UUID NOT NULL REFERENCES ccass.agents(id) ON DELETE CASCADE,
  channel VARCHAR(32) NOT NULL DEFAULT 'chat',
  max_concurrency INT NOT NULL DEFAULT 1,
  reserved_count INT NOT NULL DEFAULT 0,
  active_count INT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_agent_capacity_agent_channel_key UNIQUE (agent_id, channel)
);

CREATE TABLE IF NOT EXISTS ccass.skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  key VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_skills_org_key_key UNIQUE (organization_id, key)
);

CREATE TABLE IF NOT EXISTS ccass.agent_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  agent_id UUID NOT NULL REFERENCES ccass.agents(id) ON DELETE CASCADE,
  skill_id UUID NOT NULL REFERENCES ccass.skills(id) ON DELETE CASCADE,
  proficiency INT NOT NULL DEFAULT 1,
  priority INT NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_agent_skills_agent_skill_key UNIQUE (agent_id, skill_id)
);

CREATE TABLE IF NOT EXISTS ccass.queue_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  queue_id UUID NOT NULL REFERENCES ccass.queues(id) ON DELETE CASCADE,
  skill_id UUID NOT NULL REFERENCES ccass.skills(id) ON DELETE CASCADE,
  requirement_type VARCHAR(16) NOT NULL DEFAULT 'required',
  min_proficiency INT NOT NULL DEFAULT 1,
  weight INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_queue_skills_queue_skill_key UNIQUE (queue_id, skill_id)
);

CREATE TABLE IF NOT EXISTS ccass.queue_routing_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  queue_id UUID NOT NULL UNIQUE REFERENCES ccass.queues(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  supported_intents JSONB NOT NULL DEFAULT '[]',
  example_phrases JSONB NOT NULL DEFAULT '[]',
  keywords JSONB NOT NULL DEFAULT '[]',
  language_codes JSONB NOT NULL DEFAULT '["en"]',
  skill_mapping JSONB NOT NULL DEFAULT '{}',
  classifier_version VARCHAR(32) NOT NULL DEFAULT 'v1',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ccass.routing_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  queue_id UUID NOT NULL UNIQUE REFERENCES ccass.queues(id) ON DELETE CASCADE,
  strategy VARCHAR(32) NOT NULL DEFAULT 'skill_round_robin',
  priority INT NOT NULL DEFAULT 0,
  offer_timeout_seconds INT NOT NULL DEFAULT 30,
  max_attempts INT NOT NULL DEFAULT 3,
  overflow_queue_id UUID REFERENCES ccass.queues(id) ON DELETE SET NULL,
  after_contact_work_seconds INT NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ccass.routing_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  queue_id UUID NOT NULL UNIQUE REFERENCES ccass.queues(id) ON DELETE CASCADE,
  cursor_index INT NOT NULL DEFAULT 0,
  last_agent_id UUID REFERENCES ccass.agents(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ccass.routing_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  queue_id UUID NOT NULL REFERENCES ccass.queues(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES ccass.agents(id) ON DELETE SET NULL,
  attempt_number INT NOT NULL DEFAULT 1,
  outcome VARCHAR(32) NOT NULL DEFAULT 'pending',
  candidate_scores JSONB NOT NULL DEFAULT '[]',
  skip_reasons JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ccass_routing_attempts_conversation
  ON ccass.routing_attempts (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ccass.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  channel VARCHAR(32) NOT NULL DEFAULT 'webchat',
  external_thread_id VARCHAR(128) NOT NULL,
  webchat_id VARCHAR(64),
  visitor_id VARCHAR(128),
  contact_id UUID,
  profile_id UUID,
  queue_id UUID REFERENCES ccass.queues(id) ON DELETE SET NULL,
  assigned_agent_id UUID REFERENCES ccass.agents(id) ON DELETE SET NULL,
  assigned_user_id UUID,
  status VARCHAR(32) NOT NULL DEFAULT 'bot_active',
  priority INT NOT NULL DEFAULT 0,
  subject VARCHAR(512),
  handoff_reason VARCHAR(128),
  bot_active BOOLEAN NOT NULL DEFAULT TRUE,
  nlp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  live_agent_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  queued_at TIMESTAMPTZ,
  assigned_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  CONSTRAINT ccass_conversations_org_channel_thread_key UNIQUE (organization_id, channel, external_thread_id)
);

CREATE INDEX IF NOT EXISTS idx_ccass_conversations_org_status
  ON ccass.conversations (organization_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ccass_conversations_assigned_agent
  ON ccass.conversations (assigned_agent_id, status);

CREATE TABLE IF NOT EXISTS ccass.webchat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL UNIQUE REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  webchat_id VARCHAR(64) NOT NULL,
  visitor_id VARCHAR(128) NOT NULL,
  token_hash VARCHAR(128),
  page_origin VARCHAR(512),
  page_url TEXT,
  consent JSONB,
  prechat_answers JSONB,
  connection_state VARCHAR(32) NOT NULL DEFAULT 'connected',
  expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ccass_webchat_sessions_lookup
  ON ccass.webchat_sessions (organization_id, webchat_id, visitor_id);

CREATE TABLE IF NOT EXISTS ccass.conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  participant_type VARCHAR(32) NOT NULL,
  identity_ref VARCHAR(128) NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ccass_conversation_participants_conversation
  ON ccass.conversation_participants (conversation_id);

CREATE TABLE IF NOT EXISTS ccass.conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  external_id VARCHAR(128),
  sender_type VARCHAR(32) NOT NULL,
  recipient_type VARCHAR(32),
  direction VARCHAR(16) NOT NULL DEFAULT 'inbound',
  visibility VARCHAR(16) NOT NULL DEFAULT 'customer',
  body TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]',
  reply_to_message_id UUID REFERENCES ccass.conversation_messages(id) ON DELETE SET NULL,
  delivery_state VARCHAR(32) NOT NULL DEFAULT 'delivered',
  model_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  CONSTRAINT ccass_conversation_messages_external_key UNIQUE (organization_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ccass_conversation_messages_conversation
  ON ccass.conversation_messages (conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS ccass.message_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  message_id UUID NOT NULL REFERENCES ccass.conversation_messages(id) ON DELETE CASCADE,
  destination VARCHAR(64) NOT NULL,
  attempt_number INT NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  provider_response JSONB,
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ccass.conversation_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  queue_id UUID REFERENCES ccass.queues(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES ccass.agents(id) ON DELETE SET NULL,
  routing_attempt_id UUID REFERENCES ccass.routing_attempts(id) ON DELETE SET NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'offered',
  reason VARCHAR(128),
  offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ccass_conversation_assignments_conversation
  ON ccass.conversation_assignments (conversation_id, offered_at DESC);

-- Webchat/customer-bot NLP runtime (operational — lives in ccass, not cdp).
CREATE TABLE IF NOT EXISTS ccass.nlp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL UNIQUE REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  runtime_type VARCHAR(32) NOT NULL DEFAULT 'webchat_bot',
  skill_version_id UUID,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  end_reason VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ccass_nlp_conversations_org_status
  ON ccass.nlp_conversations (organization_id, status);

CREATE TABLE IF NOT EXISTS ccass.nlp_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  nlp_conversation_id UUID NOT NULL REFERENCES ccass.nlp_conversations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  turn_number INT NOT NULL,
  customer_message_id UUID REFERENCES ccass.conversation_messages(id) ON DELETE SET NULL,
  bot_message_id UUID REFERENCES ccass.conversation_messages(id) ON DELETE SET NULL,
  customer_text TEXT NOT NULL,
  bot_reply TEXT,
  confidence NUMERIC(5,4),
  intent VARCHAR(128),
  candidate_skills JSONB NOT NULL DEFAULT '[]',
  handoff_recommended BOOLEAN NOT NULL DEFAULT FALSE,
  handoff_reason VARCHAR(128),
  skill_key VARCHAR(128),
  model_name VARCHAR(128),
  trace_id VARCHAR(128),
  latency_ms INT,
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_nlp_turns_nlp_conversation_turn_key UNIQUE (nlp_conversation_id, turn_number)
);

CREATE INDEX IF NOT EXISTS idx_ccass_nlp_turns_conversation
  ON ccass.nlp_turns (conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS ccass.conversation_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL UNIQUE REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  rolling_summary TEXT,
  extracted_facts JSONB NOT NULL DEFAULT '[]',
  latest_summarized_message_id UUID REFERENCES ccass.conversation_messages(id) ON DELETE SET NULL,
  model_name VARCHAR(128),
  token_estimate INT,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ccass.conversation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ccass.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  actor_user_id UUID,
  actor_type VARCHAR(32) NOT NULL DEFAULT 'system',
  action VARCHAR(128) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id UUID,
  before_state JSONB,
  after_state JSONB,
  trace_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ccass.sla_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  first_response_seconds INT NOT NULL DEFAULT 120,
  resolution_seconds INT NOT NULL DEFAULT 3600,
  warning_threshold_pct INT NOT NULL DEFAULT 80,
  business_hours_mode VARCHAR(32) NOT NULL DEFAULT 'queue',
  escalation_policy JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ccass.conversation_sla_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL UNIQUE REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  sla_policy_id UUID REFERENCES ccass.sla_policies(id) ON DELETE SET NULL,
  first_response_due_at TIMESTAMPTZ,
  resolution_due_at TIMESTAMPTZ,
  first_response_warning_at TIMESTAMPTZ,
  resolution_warning_at TIMESTAMPTZ,
  breached_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ccass.dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  code VARCHAR(64) NOT NULL,
  label VARCHAR(255) NOT NULL,
  requires_note BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_dispositions_org_code_key UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS ccass.conversation_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  disposition_id UUID NOT NULL REFERENCES ccass.dispositions(id) ON DELETE RESTRICT,
  agent_id UUID REFERENCES ccass.agents(id) ON DELETE SET NULL,
  note TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NLP skill registry and shared Copilot runtime tables.
CREATE TABLE IF NOT EXISTS ccass.nlp_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  skill_key VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  skill_type VARCHAR(32) NOT NULL,
  owner_user_id UUID,
  state VARCHAR(32) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_nlp_skills_org_key_key UNIQUE (organization_id, skill_key)
);

CREATE TABLE IF NOT EXISTS ccass.nlp_skill_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  skill_id UUID NOT NULL REFERENCES ccass.nlp_skills(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  prompt_template TEXT NOT NULL,
  input_schema JSONB NOT NULL DEFAULT '{}',
  output_schema JSONB NOT NULL DEFAULT '{}',
  model_policy JSONB NOT NULL DEFAULT '{}',
  context_policy JSONB NOT NULL DEFAULT '{}',
  safety_policy JSONB NOT NULL DEFAULT '{}',
  checksum VARCHAR(128) NOT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_nlp_skill_versions_skill_version_key UNIQUE (skill_id, version_number)
);

CREATE TABLE IF NOT EXISTS ccass.nlp_skill_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  skill_version_id UUID NOT NULL REFERENCES ccass.nlp_skill_versions(id) ON DELETE CASCADE,
  role VARCHAR(32),
  surface VARCHAR(64),
  channel VARCHAR(32),
  priority INT NOT NULL DEFAULT 0,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  overrides JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ccass_nlp_skill_bindings_lookup
  ON ccass.nlp_skill_bindings (organization_id, surface, channel, enabled);

CREATE TABLE IF NOT EXISTS ccass.nlp_skill_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  skill_version_id UUID NOT NULL REFERENCES ccass.nlp_skill_versions(id) ON DELETE CASCADE,
  tool_key VARCHAR(128) NOT NULL,
  permission_class VARCHAR(32) NOT NULL DEFAULT 'tool_call',
  requires_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_nlp_skill_tools_version_tool_key UNIQUE (skill_version_id, tool_key)
);

CREATE TABLE IF NOT EXISTS ccass.nlp_skill_activation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  skill_id UUID NOT NULL REFERENCES ccass.nlp_skills(id) ON DELETE CASCADE,
  skill_version_id UUID REFERENCES ccass.nlp_skill_versions(id) ON DELETE SET NULL,
  action VARCHAR(32) NOT NULL,
  actor_user_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ccass.copilot_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'agent',
  active_surface VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ccass_copilot_sessions_user
  ON ccass.copilot_sessions (organization_id, user_id, status);

CREATE TABLE IF NOT EXISTS ccass.copilot_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES ccass.copilot_sessions(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES ccass.conversations(id) ON DELETE SET NULL,
  surface VARCHAR(64),
  turn_type VARCHAR(32) NOT NULL DEFAULT 'chat',
  agent_input TEXT,
  copilot_response TEXT,
  suggestion_text TEXT,
  final_text TEXT,
  accepted BOOLEAN,
  sent_message_id UUID REFERENCES ccass.conversation_messages(id) ON DELETE SET NULL,
  skill_key VARCHAR(128),
  model_name VARCHAR(128),
  latency_ms INT,
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ccass.copilot_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  user_id UUID,
  conversation_id UUID REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  memory_type VARCHAR(32) NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  provenance VARCHAR(64),
  expires_at TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ccass.copilot_skill_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  session_id UUID REFERENCES ccass.copilot_sessions(id) ON DELETE SET NULL,
  turn_id UUID REFERENCES ccass.copilot_turns(id) ON DELETE SET NULL,
  skill_key VARCHAR(128) NOT NULL,
  tool_key VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'started',
  token_usage JSONB,
  latency_ms INT,
  error_message TEXT,
  trace_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional FK once nlp_skill_versions exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ccass_nlp_conversations_skill_version_id_fkey'
  ) THEN
    ALTER TABLE ccass.nlp_conversations
      ADD CONSTRAINT ccass_nlp_conversations_skill_version_id_fkey
      FOREIGN KEY (skill_version_id) REFERENCES ccass.nlp_skill_versions(id) ON DELETE SET NULL;
  END IF;
END $$;
