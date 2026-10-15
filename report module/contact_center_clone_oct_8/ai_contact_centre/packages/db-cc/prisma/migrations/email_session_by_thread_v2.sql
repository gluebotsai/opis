-- The sender unique index lives on the partitioned parent under a _part name.
-- Drop it so a customer can have one open conversation per Gmail thread.

DROP INDEX IF EXISTS ccass.idx_ccass_conversations_open_email_sender_unique_part;
DROP INDEX IF EXISTS ccass.idx_ccass_conversations_open_email_sender_part;

DROP INDEX IF EXISTS ccass.conversations_call_organization_id_lower_coalesce_channel_idx;
DROP INDEX IF EXISTS ccass.conversations_default_organization_id_lower_coalesce_channe_idx;
DROP INDEX IF EXISTS ccass.conversations_email_organization_id_lower_coalesce_channel_idx;
DROP INDEX IF EXISTS ccass.conversations_facebook_organization_id_lower_coalesce_chann_idx;
DROP INDEX IF EXISTS ccass.conversations_instagram_organization_id_lower_coalesce_chan_idx;
DROP INDEX IF EXISTS ccass.conversations_voice_organization_id_lower_coalesce_channel_idx;
DROP INDEX IF EXISTS ccass.conversations_webchat_organization_id_lower_coalesce_channe_idx;
DROP INDEX IF EXISTS ccass.conversations_whatsapp_organization_id_lower_coalesce_chann_idx;
