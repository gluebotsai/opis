-- Canonical tenant-scoped channel automation policy (Step 4).
-- Replaces competing per-channel policy sources over time.

CREATE TABLE IF NOT EXISTS ccass.channel_automation_policies (
  id                      BIGSERIAL PRIMARY KEY,
  organization_id         BIGINT NOT NULL,
  channel_config_id       BIGINT NOT NULL,
  channel                 VARCHAR(32) NOT NULL,
  bot_enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  live_agent_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  automation_mode         VARCHAR(32) NOT NULL DEFAULT 'auto_send',
  confidence_threshold    NUMERIC(4,3) NOT NULL DEFAULT 0.850,
  default_queue_id        BIGINT,
  allowed_queue_ids       BIGINT[] NOT NULL DEFAULT '{}',
  handoff_message         TEXT,
  no_agent_behavior       VARCHAR(32) NOT NULL DEFAULT 'queue_and_notify',
  inactivity_close_seconds INTEGER NOT NULL DEFAULT 86400,
  shadow_mode             BOOLEAN NOT NULL DEFAULT FALSE,
  policy_version          INTEGER NOT NULL DEFAULT 1,
  status                  VARCHAR(16) NOT NULL DEFAULT 'active',
  channel_settings        JSONB NOT NULL DEFAULT '{}',
  source_metadata         JSONB NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_channel_automation_policies_config UNIQUE (organization_id, channel_config_id),
  CONSTRAINT chk_cap_channel CHECK (channel IN ('webchat', 'email', 'whatsapp', 'social')),
  CONSTRAINT chk_cap_automation_mode CHECK (automation_mode IN ('auto_send', 'draft_only', 'disabled')),
  CONSTRAINT chk_cap_no_agent CHECK (no_agent_behavior IN ('queue_and_notify', 'bot_continue', 'close_with_message')),
  CONSTRAINT chk_cap_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT chk_cap_confidence CHECK (confidence_threshold >= 0 AND confidence_threshold <= 1)
);

CREATE INDEX IF NOT EXISTS idx_cap_org_channel
  ON ccass.channel_automation_policies (organization_id, channel);

CREATE INDEX IF NOT EXISTS idx_cap_channel_config
  ON ccass.channel_automation_policies (channel_config_id)
  WHERE status = 'active';
