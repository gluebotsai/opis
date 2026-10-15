-- A2A spoke durable tasks (separate from agent_tasks).

CREATE TABLE IF NOT EXISTS ccass.a2a_tasks (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL,
  organization_id BIGINT NOT NULL,
  caller_subject TEXT NOT NULL,
  command_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_envelope JSONB NOT NULL DEFAULT '{}'::jsonb,
  context_id TEXT,
  state TEXT NOT NULL DEFAULT 'SUBMITTED',
  result_artifact JSONB,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT a2a_tasks_public_id_unique UNIQUE (public_id),
  CONSTRAINT a2a_tasks_idempotency_unique UNIQUE (caller_subject, organization_id, command_id),
  CONSTRAINT a2a_tasks_state_check CHECK (
    state IN (
      'SUBMITTED',
      'WORKING',
      'INPUT_REQUIRED',
      'AUTH_REQUIRED',
      'COMPLETED',
      'FAILED',
      'CANCELED',
      'REJECTED'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_a2a_tasks_org_updated
  ON ccass.a2a_tasks (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_a2a_tasks_org_caller
  ON ccass.a2a_tasks (organization_id, caller_subject, updated_at DESC);

CREATE TABLE IF NOT EXISTS ccass.a2a_task_events (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES ccass.a2a_tasks (id) ON DELETE CASCADE,
  organization_id BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_a2a_task_events_task
  ON ccass.a2a_task_events (task_id, id);

CREATE TABLE IF NOT EXISTS ccass.a2a_artifacts (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES ccass.a2a_tasks (id) ON DELETE CASCADE,
  organization_id BIGINT NOT NULL,
  artifact_name TEXT NOT NULL DEFAULT 'result',
  mime_type TEXT NOT NULL DEFAULT 'application/json',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_a2a_artifacts_task
  ON ccass.a2a_artifacts (task_id, id);
