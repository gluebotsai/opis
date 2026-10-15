CREATE TABLE IF NOT EXISTS crm.contact_buying_roles (
  id text PRIMARY KEY,
  organization_id bigint NOT NULL,
  contact_id text NOT NULL,
  company_id text NOT NULL,
  deal_id text,
  role varchar(40) NOT NULL,
  influence varchar(16),
  attitude varchar(16),
  status varchar(16) NOT NULL DEFAULT 'suggested',
  confidence double precision,
  evidence text,
  source varchar(16) NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_buying_roles_company_idx
  ON crm.contact_buying_roles (organization_id, company_id);

CREATE UNIQUE INDEX IF NOT EXISTS contact_buying_roles_company_contact_uidx
  ON crm.contact_buying_roles (organization_id, company_id, contact_id)
  WHERE deal_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contact_buying_roles_deal_contact_uidx
  ON crm.contact_buying_roles (organization_id, deal_id, contact_id)
  WHERE deal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS crm.contact_relationships (
  id text PRIMARY KEY,
  organization_id bigint NOT NULL,
  company_id text NOT NULL,
  from_contact_id text NOT NULL,
  to_contact_id text NOT NULL,
  kind varchar(32) NOT NULL,
  strength varchar(16),
  status varchar(16) NOT NULL DEFAULT 'suggested',
  evidence text,
  source varchar(16) NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_relationships_company_idx
  ON crm.contact_relationships (organization_id, company_id);

CREATE UNIQUE INDEX IF NOT EXISTS contact_relationships_pair_uidx
  ON crm.contact_relationships (organization_id, company_id, from_contact_id, to_contact_id, kind);
