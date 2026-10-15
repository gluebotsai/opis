-- Support portal: org auth mode, customer identity, OTP/password, accounts, products.
-- Runtime also applies this via ensureSupportPortalSchema() in bootstrap.

ALTER TABLE ticketing.organizations
  ADD COLUMN IF NOT EXISTS portal_auth_mode TEXT NOT NULL DEFAULT 'otp';

ALTER TABLE ticketing.organizations
  ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'b2c';

DO $$
BEGIN
  ALTER TABLE ticketing.organizations
    ADD CONSTRAINT organizations_portal_auth_mode_check
    CHECK (portal_auth_mode IN ('password', 'otp'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ticketing.organizations
    ADD CONSTRAINT organizations_business_type_check
    CHECK (business_type IN ('b2b', 'b2c'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS ticketing.accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES ticketing.organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'Active'
                     CHECK (status IN ('Active', 'Inactive')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_accounts_org
  ON ticketing.accounts(organization_id);

ALTER TABLE ticketing.customers
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES ticketing.accounts(id) ON DELETE SET NULL;

ALTER TABLE ticketing.customers
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE ticketing.customers
  ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;

ALTER TABLE ticketing.customers
  ADD COLUMN IF NOT EXISTS last_portal_login_at TIMESTAMPTZ;

ALTER TABLE ticketing.customers
  ALTER COLUMN email DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_org_email_ci
  ON ticketing.customers (organization_id, lower(email))
  WHERE email IS NOT NULL AND btrim(email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_org_phone
  ON ticketing.customers (organization_id, phone)
  WHERE phone IS NOT NULL AND btrim(phone) <> '';

-- ticketing.products REMOVED (sql/014). Use inventory.products.
-- Entitlements: contact_products / account_products (text product_id).
-- Historical local-catalog DDL intentionally omitted so re-runs do not recreate it.

CREATE TABLE IF NOT EXISTS ticketing.customer_otp_challenges (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES ticketing.organizations(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES ticketing.customers(id) ON DELETE CASCADE,
  identifier       TEXT NOT NULL,
  channel          TEXT NOT NULL CHECK (channel IN ('email', 'phone')),
  code_hash        TEXT NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  expires_at       TIMESTAMPTZ NOT NULL,
  consumed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_otp_org_ident
  ON ticketing.customer_otp_challenges(organization_id, identifier, created_at DESC);

CREATE TABLE IF NOT EXISTS ticketing.customer_password_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES ticketing.organizations(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES ticketing.customers(id) ON DELETE CASCADE,
  token_hash       TEXT NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  consumed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_pw_tokens_hash
  ON ticketing.customer_password_tokens(token_hash)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS ticketing.customer_portal_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES ticketing.organizations(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES ticketing.customers(id) ON DELETE CASCADE,
  device_label     TEXT,
  ip_address       TEXT,
  user_agent       TEXT,
  last_active_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_portal_sessions_customer
  ON ticketing.customer_portal_sessions(customer_id, revoked_at);
