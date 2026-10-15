-- my_account_qa: CRM contacts (person details). No dedicated contacts table existed;
-- leads/partners have contact fields but are sales entities. This table is the
-- account-side source for CRM Contact module person/company contact details.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name character varying(255) NOT NULL,
  last_name character varying(255) NOT NULL,
  email character varying(255) NOT NULL,
  phone character varying(64),
  title character varying(128),
  address_line text,
  city character varying(128),
  country character varying(128),
  company_name character varying(255),
  company_domain character varying(255),
  company_industry character varying(128),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT contacts_email_key UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_contacts_organization_id ON public.contacts (organization_id);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON public.contacts (last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_contacts_company_name ON public.contacts (company_name);
