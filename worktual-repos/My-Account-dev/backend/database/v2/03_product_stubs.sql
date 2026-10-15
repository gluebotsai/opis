-- Starter product-schema tables (organization-scoped). Expand as product apps land.

CREATE TABLE IF NOT EXISTS crm.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  location_id VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_accounts_org ON crm.accounts(organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS crm.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  account_id UUID REFERENCES crm.accounts(id) ON DELETE SET NULL,
  email VARCHAR(255),
  full_name VARCHAR(255),
  phone VARCHAR(64),
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_org ON crm.contacts(organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS cvm.value_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  profile_key VARCHAR(255) NOT NULL,
  score NUMERIC(14, 4) NOT NULL DEFAULT 0,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, profile_key)
);
CREATE INDEX IF NOT EXISTS idx_cvm_value_scores_org ON cvm.value_scores(organization_id, scored_at DESC);

CREATE TABLE IF NOT EXISTS ticketing.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  ticket_number VARCHAR(64) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  priority VARCHAR(32) NOT NULL DEFAULT 'medium',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, ticket_number)
);
CREATE INDEX IF NOT EXISTS idx_ticketing_tickets_org ON ticketing.tickets(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS ccass.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  display_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ccass_agents_org ON ccass.agents(organization_id, status);

CREATE TABLE IF NOT EXISTS cdp.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  external_id VARCHAR(255),
  email VARCHAR(255),
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cdp_profiles_org ON cdp.profiles(organization_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cdp_profiles_org_external
  ON cdp.profiles(organization_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS campaign.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  channel VARCHAR(64),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaign_campaigns_org ON campaign.campaigns(organization_id, status);
