-- Add CRM fields onto my_account_qa.public.contacts (single-table contact model)

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_stage character varying(32) NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS lead_source character varying(128),
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS crm_status character varying(32) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle_stage ON public.contacts (lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_contacts_crm_status ON public.contacts (crm_status);
