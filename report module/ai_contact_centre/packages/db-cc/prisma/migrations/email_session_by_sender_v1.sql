-- Email session boundaries: one open session per customer email (per mailbox) until end/disposition.
-- provider_thread_id tracks the latest Gmail thread for outbound reply threading.
-- Run dedupe-open-email-sessions.ts before creating the unique index if duplicates exist.

DROP INDEX IF EXISTS ccass.idx_ccass_conversations_open_email_thread;

CREATE INDEX IF NOT EXISTS idx_ccass_conversations_open_email_sender
  ON ccass.conversations (organization_id, lower(visitor_id), mailbox_connection_id)
  WHERE channel = 'email'
    AND visitor_id IS NOT NULL
    AND status NOT IN ('resolved', 'closed');

-- Unique index (apply after dedupe): idx_ccass_conversations_open_email_sender_unique
