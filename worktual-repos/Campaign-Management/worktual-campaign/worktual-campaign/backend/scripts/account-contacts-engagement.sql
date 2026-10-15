-- DEPRECATED: do not add campaign engagement to shared contacts.
-- Campaign engagement lives in campaign_db.campaign_contact_engagement.
-- To clean a mistaken add, run: npx tsx scripts/drop-account-contact-engagement.ts

ALTER TABLE public.contacts
  DROP COLUMN IF EXISTS email_unsubscribed,
  DROP COLUMN IF EXISTS email_unsubscribed_at,
  DROP COLUMN IF EXISTS email_unsubscribe_reason,
  DROP COLUMN IF EXISTS last_email_opened_at,
  DROP COLUMN IF EXISTS last_email_clicked_at,
  DROP COLUMN IF EXISTS email_open_count,
  DROP COLUMN IF EXISTS email_click_count;
