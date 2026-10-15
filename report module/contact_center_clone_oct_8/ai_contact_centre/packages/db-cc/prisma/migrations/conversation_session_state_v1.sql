-- Shared session state for any bot on a conversation.
-- Each bot stores its own object inside state and merges that key only.

DROP TABLE IF EXISTS ccass.booxoo_chat_session;

CREATE TABLE IF NOT EXISTS ccass.conversation_session_state (
  organization_id bigint NOT NULL,
  conversation_id bigint NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, conversation_id)
);
