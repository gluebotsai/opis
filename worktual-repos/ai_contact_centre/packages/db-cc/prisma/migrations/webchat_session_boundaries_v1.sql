-- Webchat session boundaries: one open conversation per visitor per widget.
-- provider_thread_id = webchatId:visitorId (stable visitor thread)
-- external_thread_id = session-scoped id (UUID from chat-service)

UPDATE ccass.conversations
SET provider_thread_id = external_thread_id
WHERE channel = 'webchat'
  AND provider_thread_id IS NULL
  AND external_thread_id LIKE '%:%';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ccass_conversations_open_webchat_visitor
  ON ccass.conversations (organization_id, webchat_id, visitor_id)
  WHERE channel = 'webchat'
    AND webchat_id IS NOT NULL
    AND visitor_id IS NOT NULL
    AND status NOT IN ('resolved', 'closed');

CREATE INDEX IF NOT EXISTS idx_ccass_conversations_webchat_provider_thread
  ON ccass.conversations (organization_id, provider_thread_id, updated_at DESC)
  WHERE channel = 'webchat'
    AND provider_thread_id IS NOT NULL;
