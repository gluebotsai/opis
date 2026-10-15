-- Fill ticketing schema gaps on worktual_bigint (structure only).
-- Converts UUID id/FK columns to BIGINT to match worktual_bigint.
-- Idempotent. Apply ONLY to database worktual_bigint — never worktual.

SET search_path TO ticketing;

-- ---------------------------------------------------------------------------
-- Missing columns on shared tables (TEXT — no bigint conversion)
-- ---------------------------------------------------------------------------
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ai_summary TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS myaccount_user_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS myaccount_organization_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_myaccount_user_id
  ON users (myaccount_user_id)
  WHERE myaccount_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_myaccount_org_id
  ON users (myaccount_organization_id)
  WHERE myaccount_organization_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- conversation_contexts / workflow_events (BIGSERIAL ids; org/user as BIGINT)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_contexts (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id          BIGINT REFERENCES users (id) ON DELETE SET NULL,
  user_key         TEXT NOT NULL CHECK (length(btrim(user_key)) BETWEEN 1 AND 255),
  session_key      TEXT NOT NULL CHECK (length(btrim(session_key)) BETWEEN 1 AND 255),
  context          JSONB NOT NULL DEFAULT '{}'::jsonb
                     CHECK (jsonb_typeof(context) = 'object'),
  version          BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ,
  UNIQUE (organization_id, user_key, session_key)
);

CREATE TABLE IF NOT EXISTS workflow_events (
  id                       BIGSERIAL PRIMARY KEY,
  organization_id          BIGINT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id                  BIGINT REFERENCES users (id) ON DELETE SET NULL,
  user_key                 TEXT NOT NULL CHECK (length(btrim(user_key)) BETWEEN 1 AND 255),
  session_key              TEXT NOT NULL CHECK (length(btrim(session_key)) BETWEEN 1 AND 255),
  request_id               TEXT NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 255),
  conversation_context_id  BIGINT REFERENCES conversation_contexts (id) ON DELETE SET NULL,
  workflow_id              TEXT CHECK (workflow_id IS NULL OR length(btrim(workflow_id)) BETWEEN 1 AND 255),
  workflow_type            TEXT NOT NULL CHECK (length(btrim(workflow_type)) BETWEEN 1 AND 128),
  event_type               TEXT NOT NULL CHECK (length(btrim(event_type)) BETWEEN 1 AND 128),
  event_data               JSONB NOT NULL DEFAULT '{}'::jsonb
                             CHECK (jsonb_typeof(event_data) = 'object'),
  version                  BIGINT NOT NULL CHECK (version > 0),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_conversation_contexts_session
  ON conversation_contexts (organization_id, user_key, session_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_contexts_actor_session
  ON conversation_contexts (organization_id, user_key, session_key);

CREATE INDEX IF NOT EXISTS idx_conversation_contexts_expiry
  ON conversation_contexts (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_contexts_context
  ON conversation_contexts USING GIN (context);

CREATE INDEX IF NOT EXISTS idx_workflow_events_session_created
  ON workflow_events (organization_id, user_key, session_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_events_workflow_version
  ON workflow_events (organization_id, workflow_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_events_expiry
  ON workflow_events (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_events_data
  ON workflow_events USING GIN (event_data);

-- ---------------------------------------------------------------------------
-- ticket_event_outbox (PK was UUID on worktual → BIGINT)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_event_outbox (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  webhook_url      TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ticket_event_outbox_pending
  ON ticket_event_outbox (status, created_at)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Proactive agent tables (PK / organization_id were UUID → BIGINT)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proactive_outbox (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL,
  event_type       TEXT NOT NULL,
  ticket_id        TEXT,
  ticket_number    TEXT,
  actor            TEXT,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS proactive_approvals (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL,
  agent_id         TEXT NOT NULL,
  ticket_id        TEXT,
  ticket_number    TEXT,
  summary          TEXT NOT NULL DEFAULT '',
  tool_name        TEXT,
  tool_args        JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS proactive_recommendations (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL,
  agent_id         TEXT NOT NULL,
  ticket_id        TEXT,
  ticket_number    TEXT,
  summary          TEXT NOT NULL DEFAULT '',
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT NOT NULL DEFAULT 'open',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proactive_audit (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT,
  agent_id         TEXT,
  ticket_id        TEXT,
  event_id         TEXT,
  decision         TEXT,
  reason           TEXT,
  tool_name        TEXT,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proactive_embeddings (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL,
  source           TEXT NOT NULL,
  source_id        TEXT NOT NULL,
  tokens           JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proactive_routing_weights (
  organization_id  BIGINT PRIMARY KEY,
  weights          JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proactive_outbox_unprocessed
  ON proactive_outbox (created_at)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_proactive_approvals_org
  ON proactive_approvals (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_proactive_recs_org
  ON proactive_recommendations (organization_id, ticket_number);
