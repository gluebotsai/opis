-- One open email conversation per Gmail thread, not per sender.
-- A customer can have several open threads. A reply stays on its own thread.

DROP INDEX IF EXISTS ccass.idx_ccass_conversations_open_email_sender_unique;
DROP INDEX IF EXISTS ccass.idx_ccass_conversations_open_email_sender;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ccass_conversations_open_email_thread_unique
  ON ccass.conversations (
    organization_id,
    channel,
    COALESCE(mailbox_connection_id, 0::bigint),
    provider_thread_id
  )
  WHERE channel = 'email'
    AND provider_thread_id IS NOT NULL
    AND status NOT IN ('resolved', 'closed');
