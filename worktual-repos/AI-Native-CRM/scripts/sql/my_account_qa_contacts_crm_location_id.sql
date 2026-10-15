-- Hard link from contacts to CRM company locations (crm_qa.company_locations.id as text cuid)

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS crm_location_id text;

CREATE INDEX IF NOT EXISTS idx_contacts_crm_location_id
  ON public.contacts (crm_location_id)
  WHERE crm_location_id IS NOT NULL;
