-- Phase 4: org + business type on account users (session source of truth)
-- Apply against my_account_qa

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS business_type text;

CREATE INDEX IF NOT EXISTS idx_users_organization_id
  ON public.users (organization_id);

COMMENT ON COLUMN public.users.organization_id IS
  'CRM tenant id (matches crm_qa organization_id).';
COMMENT ON COLUMN public.users.business_type IS
  'b2b | b2c | b2b2c — preferred over email heuristic at login.';
