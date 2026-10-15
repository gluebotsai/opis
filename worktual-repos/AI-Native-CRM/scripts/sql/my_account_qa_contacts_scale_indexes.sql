-- Indexes for my_account_qa.public.contacts list/search at scale.
-- Run against ACCOUNT_DATABASE_URL / my_account_qa.

CREATE INDEX IF NOT EXISTS contacts_updated_at_idx
  ON public.contacts (updated_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS contacts_lifecycle_stage_idx
  ON public.contacts (lifecycle_stage)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS contacts_crm_status_idx
  ON public.contacts (crm_status)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS contacts_email_idx
  ON public.contacts (email);

CREATE INDEX IF NOT EXISTS contacts_company_name_idx
  ON public.contacts (company_name);
