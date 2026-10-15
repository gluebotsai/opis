-- Phase 1 conversation lifecycle, transfer, and disposition foundations.
-- Additive only: legacy ccass.conversations.status values remain authoritative for compatibility.

ALTER TABLE ccass.conversations
  ADD COLUMN IF NOT EXISTS lifecycle_state VARCHAR(32) NOT NULL DEFAULT 'bot',
  ADD COLUMN IF NOT EXISTS lifecycle_version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_reason VARCHAR(128),
  ADD COLUMN IF NOT EXISTS end_actor VARCHAR(32),
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disposition_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS disposition_note TEXT,
  ADD COLUMN IF NOT EXISTS resolution_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS resolution_summary TEXT,
  ADD COLUMN IF NOT EXISTS resolution_data JSONB NOT NULL DEFAULT '{}';

-- Explicitly map existing legacy statuses instead of renaming or constraining them.
UPDATE ccass.conversations
SET lifecycle_state = CASE status
  WHEN 'bot_active' THEN 'bot'
  WHEN 'queued' THEN 'waiting'
  WHEN 'assigned' THEN 'offered'
  WHEN 'active' THEN 'connected'
  WHEN 'resolved' THEN 'ended'
  WHEN 'closed' THEN 'ended'
  ELSE 'waiting'
END
WHERE lifecycle_state = 'bot'
  AND status <> 'bot_active';

CREATE INDEX IF NOT EXISTS idx_ccass_conversations_org_lifecycle
  ON ccass.conversations (organization_id, lifecycle_state, updated_at DESC);

ALTER TABLE ccass.webchat_sessions
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_reason VARCHAR(128),
  ADD COLUMN IF NOT EXISTS ended_by VARCHAR(32);

ALTER TABLE ccass.dispositions
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS category VARCHAR(64) NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(64),
  ADD COLUMN IF NOT EXISTS requires_resolution BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Provide a usable tenant-scoped baseline while allowing administrators to add
-- or deactivate organization-specific dispositions later.
INSERT INTO ccass.dispositions (
  organization_id,
  code,
  label,
  description,
  category,
  outcome,
  requires_note,
  requires_resolution,
  sort_order
)
SELECT
  organization.id,
  disposition.code,
  disposition.label,
  disposition.description,
  disposition.category,
  disposition.outcome,
  disposition.requires_note,
  TRUE,
  disposition.sort_order
FROM accounts.organizations organization
CROSS JOIN (
  VALUES
    ('issue_resolved', 'Issue resolved', 'The customer issue was resolved during this interaction.', 'resolution', 'resolved', FALSE, 10),
    ('follow_up_required', 'Follow-up required', 'Additional work or customer follow-up is required.', 'follow_up', 'unresolved', TRUE, 20),
    ('transferred_to_specialist', 'Transferred to specialist', 'The interaction was transferred to another queue or agent.', 'transfer', 'transferred', TRUE, 30),
    ('customer_disconnected', 'Customer disconnected', 'The customer ended or left the interaction.', 'closure', 'unresolved', FALSE, 40)
) AS disposition(code, label, description, category, outcome, requires_note, sort_order)
WHERE organization.lifecycle_status = 'active'
ON CONFLICT (organization_id, code) DO NOTHING;

ALTER TABLE ccass.conversation_dispositions
  ADD COLUMN IF NOT EXISTS applied_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'agent',
  ADD COLUMN IF NOT EXISTS resolution_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS resolution_data JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_final BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_ccass_conversation_dispositions_conversation
  ON ccass.conversation_dispositions (organization_id, conversation_id, applied_at DESC);

CREATE TABLE IF NOT EXISTS ccass.conversation_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  from_queue_id UUID REFERENCES ccass.queues(id) ON DELETE SET NULL,
  from_agent_id UUID REFERENCES ccass.agents(id) ON DELETE SET NULL,
  from_user_id UUID,
  to_queue_id UUID NOT NULL REFERENCES ccass.queues(id) ON DELETE RESTRICT,
  requested_agent_id UUID REFERENCES ccass.agents(id) ON DELETE SET NULL,
  offered_agent_id UUID REFERENCES ccass.agents(id) ON DELETE SET NULL,
  requested_by_user_id UUID,
  state VARCHAR(32) NOT NULL DEFAULT 'requested',
  notes TEXT,
  disposition_code VARCHAR(64),
  resolution_code VARCHAR(64),
  resolution_data JSONB NOT NULL DEFAULT '{}',
  routing_attempt_id UUID REFERENCES ccass.routing_attempts(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  offered_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ccass_conversation_transfers_conversation
  ON ccass.conversation_transfers (organization_id, conversation_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_ccass_conversation_transfers_sender
  ON ccass.conversation_transfers (organization_id, from_agent_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_ccass_conversation_transfers_receiver
  ON ccass.conversation_transfers (organization_id, offered_agent_id, state, requested_at DESC);
