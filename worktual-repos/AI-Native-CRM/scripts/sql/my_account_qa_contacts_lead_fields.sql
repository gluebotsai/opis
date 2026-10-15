-- Lead qualification fields for enterprise B2B (my_account_qa.public.contacts)

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS lead_status character varying(32) NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS disqualify_reason character varying(64),
  ADD COLUMN IF NOT EXISTS bant_budget boolean,
  ADD COLUMN IF NOT EXISTS bant_authority boolean,
  ADD COLUMN IF NOT EXISTS bant_need boolean,
  ADD COLUMN IF NOT EXISTS bant_timeline boolean,
  ADD COLUMN IF NOT EXISTS converted_deal_id text,
  ADD COLUMN IF NOT EXISTS organization_id uuid;

CREATE INDEX IF NOT EXISTS idx_contacts_owner_lead_status
  ON public.contacts (owner_user_id, lead_status);
CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle_lead_status
  ON public.contacts (lifecycle_stage, lead_status);
CREATE INDEX IF NOT EXISTS idx_contacts_organization_id
  ON public.contacts (organization_id);
CREATE INDEX IF NOT EXISTS idx_contacts_organization_updated
  ON public.contacts (organization_id, updated_at DESC);
