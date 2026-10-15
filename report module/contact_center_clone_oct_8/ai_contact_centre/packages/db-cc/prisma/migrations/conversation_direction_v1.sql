-- Conversation-level direction distinguishes customer-initiated threads from agent callbacks.

ALTER TABLE ccass.conversations
  ADD COLUMN IF NOT EXISTS direction VARCHAR(16) NOT NULL DEFAULT 'inbound';

ALTER TABLE ccass.conversations
  DROP CONSTRAINT IF EXISTS ccass_conversations_direction_check;

ALTER TABLE ccass.conversations
  ADD CONSTRAINT ccass_conversations_direction_check
  CHECK (direction IN ('inbound', 'outbound'));

-- Backfill threads opened from callback tasks so monitoring does not treat them as inbound reconnections.
UPDATE ccass.conversations c
SET direction = 'outbound'
FROM ccass.agent_tasks t
WHERE t.conversation_id = c.id
  AND t.organization_id = c.organization_id
  AND t.task_type = 'callback'
  AND c.direction = 'inbound';

CREATE INDEX IF NOT EXISTS idx_ccass_conversations_org_direction
  ON ccass.conversations (organization_id, direction)
  WHERE direction = 'outbound';
