-- Agent personal task queue (follow-ups, callbacks, escalations, co-worker suggestions).

CREATE TABLE IF NOT EXISTS ccass.agent_tasks (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  assigned_user_id BIGINT NOT NULL,
  created_by_user_id BIGINT,
  contact_id BIGINT,
  conversation_id BIGINT,
  task_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  priority VARCHAR(16) NOT NULL DEFAULT 'normal',
  source VARCHAR(16) NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  notes TEXT,
  channel VARCHAR(32),
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  assigned_by_user_id BIGINT,
  assigned_by_label TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_tasks_status_check CHECK (status IN ('open', 'completed', 'dismissed')),
  CONSTRAINT agent_tasks_type_check CHECK (task_type IN ('follow_up', 'callback', 'escalation', 'suggestion')),
  CONSTRAINT agent_tasks_source_check CHECK (source IN ('self', 'admin', 'coworker', 'system')),
  CONSTRAINT agent_tasks_priority_check CHECK (priority IN ('low', 'normal', 'high', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_org_user_status_due
  ON ccass.agent_tasks (organization_id, assigned_user_id, status, due_at);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_org_contact
  ON ccass.agent_tasks (organization_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_seed_pack
  ON ccass.agent_tasks ((metadata->>'seedPack'))
  WHERE metadata ? 'seedPack';
