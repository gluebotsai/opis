ALTER TABLE ccass.conversation_notes
  ADD COLUMN IF NOT EXISTS title TEXT;

ALTER TABLE ccass.workspace_common_notes
  ADD COLUMN IF NOT EXISTS title TEXT;
