-- Meta Instagram/Facebook message ids (mid) exceed 128 chars; WhatsApp ids can too.
ALTER TABLE ccass.conversation_messages
  ALTER COLUMN external_id TYPE VARCHAR(512);

ALTER TABLE ccass.conversation_message_attachments
  ALTER COLUMN external_id TYPE VARCHAR(512);
