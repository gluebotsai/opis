-- Durable offer expiry for restart-safe ringing.
ALTER TABLE ccass.conversation_assignments
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ccass_conversation_assignments_expired_offers
  ON ccass.conversation_assignments (organization_id, expires_at)
  WHERE state = 'offered' AND expires_at IS NOT NULL;

-- Per-conversation event sequence for realtime gap detection.
ALTER TABLE ccass.conversations
  ADD COLUMN IF NOT EXISTS event_sequence BIGINT NOT NULL DEFAULT 0;

ALTER TABLE ccass.conversations
  ADD COLUMN IF NOT EXISTS previous_conversation_id BIGINT REFERENCES ccass.conversations(id) ON DELETE SET NULL;

ALTER TABLE ccass.conversations
  ADD COLUMN IF NOT EXISTS visitor_session_token TEXT;

CREATE INDEX IF NOT EXISTS idx_ccass_conversations_webchat_session_resume
  ON ccass.conversations (organization_id, channel, visitor_session_token)
  WHERE visitor_session_token IS NOT NULL
    AND status IN ('bot_active', 'queued', 'assigned', 'active');
