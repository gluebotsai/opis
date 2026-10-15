-- Email session boundaries: separate Gmail thread from conversation session key.
-- One open email session per provider thread; new session after end/disposition.

ALTER TABLE ccass.conversations
  ADD COLUMN IF NOT EXISTS provider_thread_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS previous_conversation_id UUID
    REFERENCES ccass.conversations(id) ON DELETE SET NULL;

UPDATE ccass.conversations
SET provider_thread_id = external_thread_id
WHERE channel = 'email'
  AND provider_thread_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ccass_conversations_provider_thread
  ON ccass.conversations (organization_id, provider_thread_id, updated_at DESC)
  WHERE channel = 'email' AND provider_thread_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ccass_conversations_open_email_thread
  ON ccass.conversations (organization_id, provider_thread_id)
  WHERE channel = 'email'
    AND provider_thread_id IS NOT NULL
    AND status NOT IN ('resolved', 'closed');
