-- ccass operational routing tables (published from accounts.setup_ccaas_*)

CREATE TABLE IF NOT EXISTS ccass.queues (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  setup_queue_id UUID NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  team_id UUID NOT NULL,
  business_hours_id UUID,
  shift_types JSONB NOT NULL DEFAULT '[]',
  skills JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ccass_queues_org_status
  ON ccass.queues (organization_id, status);

CREATE TABLE IF NOT EXISTS ccass.queue_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES ccass.queues(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES ccass.agents(id) ON DELETE CASCADE,
  setup_user_id UUID NOT NULL,
  shift_type VARCHAR(32) NOT NULL DEFAULT 'Regular',
  handles_calls BOOLEAN NOT NULL DEFAULT FALSE,
  handles_email BOOLEAN NOT NULL DEFAULT FALSE,
  handles_social BOOLEAN NOT NULL DEFAULT FALSE,
  handles_chat BOOLEAN NOT NULL DEFAULT FALSE,
  chat_concurrency INT NOT NULL DEFAULT 1,
  email_concurrency INT NOT NULL DEFAULT 1,
  social_concurrency INT NOT NULL DEFAULT 1,
  handles_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  handles_instagram BOOLEAN NOT NULL DEFAULT FALSE,
  handles_facebook BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_concurrency INT NOT NULL DEFAULT 1,
  instagram_concurrency INT NOT NULL DEFAULT 1,
  facebook_concurrency INT NOT NULL DEFAULT 1,
  call_type VARCHAR(16) NOT NULL DEFAULT 'both',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_queue_members_queue_agent_shift_key UNIQUE (queue_id, agent_id, shift_type)
);

CREATE INDEX IF NOT EXISTS idx_ccass_queue_members_agent
  ON ccass.queue_members (agent_id);

CREATE TABLE IF NOT EXISTS ccass.agent_presence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  agent_id UUID NOT NULL UNIQUE REFERENCES ccass.agents(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL DEFAULT 'offline',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ccass_agent_presence_org_status
  ON ccass.agent_presence (organization_id, status);
