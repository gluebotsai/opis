-- Drop CRM-only columns from shared my_account_qa.public.contacts.
-- Run AFTER scripts/backfill-contact-profiles.ts has copied data into crm_qa.contact_profiles.
--
-- Apply: psql "$ACCOUNT_DATABASE_URL" -f scripts/sql/my_account_qa_contacts_drop_crm_fields.sql

DROP INDEX IF EXISTS idx_contacts_lifecycle_stage;
DROP INDEX IF EXISTS idx_contacts_crm_status;
DROP INDEX IF EXISTS idx_contacts_owner_lead_status;
DROP INDEX IF EXISTS idx_contacts_lifecycle_lead_status;

ALTER TABLE public.contacts
  DROP COLUMN IF EXISTS owner_user_id,
  DROP COLUMN IF EXISTS lifecycle_stage,
  DROP COLUMN IF EXISTS lead_source,
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS crm_status,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS lead_status,
  DROP COLUMN IF EXISTS disqualify_reason,
  DROP COLUMN IF EXISTS bant_budget,
  DROP COLUMN IF EXISTS bant_authority,
  DROP COLUMN IF EXISTS bant_need,
  DROP COLUMN IF EXISTS bant_timeline,
  DROP COLUMN IF EXISTS converted_deal_id,
  DROP COLUMN IF EXISTS crm_company_id,
  DROP COLUMN IF EXISTS crm_location_id,
  DROP COLUMN IF EXISTS is_pinned;
