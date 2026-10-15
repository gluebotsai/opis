-- Queue membership: agents can belong to multiple teams
CREATE TABLE IF NOT EXISTS agent_queue_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  queue_id         UUID NOT NULL REFERENCES agent_queues(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (queue_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_aqm_organisation_id ON agent_queue_members(organisation_id);
CREATE INDEX IF NOT EXISTS idx_aqm_user_id ON agent_queue_members(user_id);
CREATE INDEX IF NOT EXISTS idx_aqm_queue_id ON agent_queue_members(queue_id);
