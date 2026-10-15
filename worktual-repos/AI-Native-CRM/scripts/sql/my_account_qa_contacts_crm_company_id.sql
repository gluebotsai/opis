-- Hard link from contacts to CRM companies (crm_qa.companies.id as text cuid)

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS crm_company_id text;

CREATE INDEX IF NOT EXISTS idx_contacts_crm_company_id
  ON public.contacts (crm_company_id)
  WHERE crm_company_id IS NOT NULL;
