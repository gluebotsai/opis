-- One campaign outcome per auto-bot call. A later save for the same session replaces it.

CREATE TABLE IF NOT EXISTS ccass.voice_call_outcomes (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  session_id VARCHAR(128) NOT NULL,
  conversation_id BIGINT,
  outcome VARCHAR(32) NOT NULL,
  reason TEXT,
  callback_at TIMESTAMPTZ,
  timezone VARCHAR(64),
  mobile VARCHAR(32) NOT NULL,
  customer_name VARCHAR(200),
  email VARCHAR(320),
  instruction TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'closed',
  triggered_session_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT voice_call_outcomes_org_session_key UNIQUE (organization_id, session_id),
  CONSTRAINT voice_call_outcomes_outcome_check CHECK (
    outcome IN ('Interested', 'Qualified', 'Not Interested', 'Callback')
  ),
  CONSTRAINT voice_call_outcomes_callback_check CHECK (
    (
      outcome = 'Callback'
      AND callback_at IS NOT NULL
      AND NULLIF(btrim(timezone), '') IS NOT NULL
    )
    OR (outcome <> 'Callback' AND callback_at IS NULL)
  ),
  CONSTRAINT voice_call_outcomes_status_check CHECK (
    (
      outcome = 'Callback'
      AND status IN ('pending', 'triggered')
    )
    OR (
      outcome <> 'Callback'
      AND status = 'closed'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_voice_call_outcomes_conversation
  ON ccass.voice_call_outcomes (organization_id, conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voice_call_outcomes_pending
  ON ccass.voice_call_outcomes (callback_at)
  WHERE status = 'pending';
