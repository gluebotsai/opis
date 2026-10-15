-- Phase 1 realtime/media foundations.
-- Additive only: stores receipt and attachment metadata, never attachment bytes.

ALTER TABLE ccass.conversation_messages
  ADD COLUMN IF NOT EXISTS message_type VARCHAR(32) NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS attachment_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

UPDATE ccass.conversation_messages
SET sent_at = COALESCE(sent_at, created_at)
WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS ccass.message_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES ccass.conversation_messages(id) ON DELETE CASCADE,
  recipient_type VARCHAR(32) NOT NULL,
  recipient_ref VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'sent',
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_message_receipts_status_check
    CHECK (status IN ('sent', 'delivered', 'read')),
  CONSTRAINT ccass_message_receipts_recipient_key
    UNIQUE (organization_id, message_id, recipient_type, recipient_ref)
);

CREATE INDEX IF NOT EXISTS idx_ccass_message_receipts_conversation
  ON ccass.message_receipts (organization_id, conversation_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ccass.conversation_message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES ccass.conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES ccass.conversation_messages(id) ON DELETE CASCADE,
  external_id VARCHAR(128),
  storage_key TEXT NOT NULL,
  file_name VARCHAR(512) NOT NULL,
  content_type VARCHAR(255) NOT NULL,
  byte_size BIGINT NOT NULL,
  checksum_sha256 VARCHAR(64),
  download_url TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'available',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ccass_message_attachments_byte_size_check CHECK (byte_size >= 0),
  CONSTRAINT ccass_message_attachments_status_check
    CHECK (status IN ('pending', 'available', 'blocked', 'expired')),
  CONSTRAINT ccass_message_attachments_external_key
    UNIQUE (organization_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ccass_message_attachments_message
  ON ccass.conversation_message_attachments (organization_id, message_id, created_at ASC);
