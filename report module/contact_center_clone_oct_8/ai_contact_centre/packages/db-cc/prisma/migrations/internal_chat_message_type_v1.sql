-- attachment_bundle is 17 chars; message_type was VARCHAR(16)
ALTER TABLE ccass.internal_chat_messages
  ALTER COLUMN message_type TYPE VARCHAR(32);
