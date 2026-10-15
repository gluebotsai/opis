-- Agent memory: user preference scratchpad + long-term facts
-- (build-nlp-agents skill memory.md)

CREATE TABLE IF NOT EXISTS ticketing.agent_user_preferences (
  organization_id  BIGINT NOT NULL,
  user_key         TEXT NOT NULL CHECK (length(btrim(user_key)) BETWEEN 1 AND 255),
  soft             JSONB NOT NULL DEFAULT '{}'::jsonb
                     CHECK (jsonb_typeof(soft) = 'object'),
  hard             JSONB NOT NULL DEFAULT '{}'::jsonb
                     CHECK (jsonb_typeof(hard) = 'object'),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_key)
);

CREATE TABLE IF NOT EXISTS ticketing.agent_long_term_memory (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL,
  user_key         TEXT NOT NULL CHECK (length(btrim(user_key)) BETWEEN 1 AND 255),
  conversation_id  TEXT CHECK (
                     conversation_id IS NULL
                     OR length(btrim(conversation_id)) BETWEEN 1 AND 255
                   ),
  kind             TEXT NOT NULL DEFAULT 'fact'
                     CHECK (length(btrim(kind)) BETWEEN 1 AND 64),
  content          TEXT NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 4000),
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb
                     CHECK (jsonb_typeof(payload) = 'object'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_ltm_actor
  ON ticketing.agent_long_term_memory (organization_id, user_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_ltm_content
  ON ticketing.agent_long_term_memory
  USING GIN (to_tsvector('english', content));
