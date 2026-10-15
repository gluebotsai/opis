-- Widen internal chat message_type for future values
ALTER TABLE ccass.internal_chat_messages
  ALTER COLUMN message_type TYPE VARCHAR(100);
