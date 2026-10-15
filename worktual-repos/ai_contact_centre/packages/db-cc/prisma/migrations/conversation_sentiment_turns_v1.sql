-- Per-turn dual-axis sentiment for live agent workspace sessions.

CREATE TABLE IF NOT EXISTS ccass.conversation_sentiment_turns (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  conversation_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  trigger_role VARCHAR(16) NOT NULL,
  customer_label VARCHAR(32) NOT NULL,
  customer_score SMALLINT NOT NULL,
  agent_label VARCHAR(32) NOT NULL,
  agent_score SMALLINT NOT NULL,
  confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale JSONB NOT NULL DEFAULT '{}'::jsonb,
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_name VARCHAR(128),
  trace_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversation_sentiment_turns_org_message_key
    UNIQUE (organization_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_sentiment_turns_conv
  ON ccass.conversation_sentiment_turns (conversation_id, created_at DESC);
