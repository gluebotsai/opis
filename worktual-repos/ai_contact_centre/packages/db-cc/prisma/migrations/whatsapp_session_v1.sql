-- WhatsApp session boundaries: provider thread = customer phone; session key = external_thread_id.

ALTER TABLE ccass.conversations
  ADD COLUMN IF NOT EXISTS channel_config_id UUID;

CREATE INDEX IF NOT EXISTS idx_ccass_conversations_channel_config
  ON ccass.conversations (organization_id, channel_config_id)
  WHERE channel_config_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ccass_conversations_open_whatsapp_thread
  ON ccass.conversations (organization_id, provider_thread_id)
  WHERE channel = 'whatsapp'
    AND provider_thread_id IS NOT NULL
    AND status NOT IN ('resolved', 'closed');
