-- Add organization_id tenancy column to accounts tenant tables + backfill + sync triggers.

-- 1) Ensure organizations can represent prospects (pre-payment).
ALTER TABLE accounts.organizations
  ALTER COLUMN source_lead_id DROP NOT NULL;

ALTER TABLE accounts.organizations
  ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'active';

UPDATE accounts.organizations
SET lifecycle_status = 'active'
WHERE lifecycle_status IS NULL OR lifecycle_status = '';

-- 2) Leads carry organization_id (tenancy key). Keep converted_organization_id for compatibility.
ALTER TABLE accounts.leads
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_leads_organization_id ON accounts.leads(organization_id);

-- Backfill: link leads that already have converted orgs
UPDATE accounts.leads l
SET organization_id = l.converted_organization_id
WHERE l.organization_id IS NULL
  AND l.converted_organization_id IS NOT NULL;

-- Backfill: create prospect orgs for leads still missing organization_id
INSERT INTO accounts.organizations (
  id, source_lead_id, tenant_id, company_name, industry_type, contact_name, designation,
  work_email, admin_email, tax_number, billing_address, website_url, country, company_size,
  mobile_country_code, mobile_number, lifecycle_status, converted_at, created_at, updated_at, reseller_id
)
SELECT
  gen_random_uuid(),
  l.id,
  l.tenant_id,
  l.company_name,
  l.industry_type,
  l.contact_name,
  l.designation,
  l.work_email,
  l.admin_email,
  l.tax_number,
  l.billing_address,
  l.website_url,
  l.country,
  l.company_size,
  l.mobile_country_code,
  l.mobile_number,
  'prospect',
  NOW(),
  NOW(),
  NOW(),
  l.reseller_id
FROM accounts.leads l
WHERE l.organization_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM accounts.organizations o WHERE o.source_lead_id = l.id
  );

UPDATE accounts.leads l
SET organization_id = o.id
FROM accounts.organizations o
WHERE l.organization_id IS NULL
  AND o.source_lead_id = l.id;

-- 3) Denormalized organization_id on descendant tables
ALTER TABLE accounts.lead_assignments
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.additional_addresses
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.branches
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.quote_sessions
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.quotations
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.product_assignments
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.product_summary_items
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.quotation_invoices
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.payments
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.quotation_branch_payments
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.payment_webhook_events
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE SET NULL;
ALTER TABLE accounts.active_products
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.subscription_entitlements
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.subscription_items
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.product_access_grants
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.usage_metrics
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.renewal_events
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.subscription_invoices
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.support_ticket_messages
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;
ALTER TABLE accounts.partner_commission_entries
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES accounts.organizations(id) ON DELETE CASCADE;

-- Backfill from leads / parents
UPDATE accounts.lead_assignments x SET organization_id = l.organization_id
FROM accounts.leads l WHERE x.lead_id = l.id AND x.organization_id IS NULL;
UPDATE accounts.additional_addresses x SET organization_id = l.organization_id
FROM accounts.leads l WHERE x.lead_id = l.id AND x.organization_id IS NULL;
UPDATE accounts.branches x SET organization_id = l.organization_id
FROM accounts.leads l WHERE x.lead_id = l.id AND x.organization_id IS NULL;
UPDATE accounts.quote_sessions x SET organization_id = l.organization_id
FROM accounts.leads l WHERE x.lead_id = l.id AND x.organization_id IS NULL;
UPDATE accounts.quotations x SET organization_id = l.organization_id
FROM accounts.leads l WHERE x.lead_id = l.id AND x.organization_id IS NULL;
UPDATE accounts.product_assignments x SET organization_id = l.organization_id
FROM accounts.leads l WHERE x.lead_id = l.id AND x.organization_id IS NULL;
UPDATE accounts.active_products x SET organization_id = l.organization_id
FROM accounts.leads l WHERE x.lead_id = l.id AND x.organization_id IS NULL;
UPDATE accounts.partner_commission_entries x SET organization_id = l.organization_id
FROM accounts.leads l WHERE x.lead_id = l.id AND x.organization_id IS NULL;

UPDATE accounts.product_summary_items x SET organization_id = q.organization_id
FROM accounts.quotations q WHERE x.quotation_id = q.id AND x.organization_id IS NULL;
UPDATE accounts.quotation_invoices x SET organization_id = q.organization_id
FROM accounts.quotations q WHERE x.quotation_id = q.id AND x.organization_id IS NULL;
UPDATE accounts.payments x SET organization_id = q.organization_id
FROM accounts.quotations q WHERE x.quotation_id = q.id AND x.organization_id IS NULL;
UPDATE accounts.quotation_branch_payments x SET organization_id = q.organization_id
FROM accounts.quotations q WHERE x.quotation_id = q.id AND x.organization_id IS NULL;
UPDATE accounts.payment_webhook_events x SET organization_id = q.organization_id
FROM accounts.quotations q WHERE x.quotation_id = q.id AND x.organization_id IS NULL;

UPDATE accounts.subscription_entitlements x SET organization_id = s.organization_id
FROM accounts.subscriptions s WHERE x.subscription_id = s.id AND x.organization_id IS NULL;
UPDATE accounts.usage_metrics x SET organization_id = s.organization_id
FROM accounts.subscriptions s WHERE x.subscription_id = s.id AND x.organization_id IS NULL;
UPDATE accounts.renewal_events x SET organization_id = s.organization_id
FROM accounts.subscriptions s WHERE x.subscription_id = s.id AND x.organization_id IS NULL;
UPDATE accounts.subscription_invoices x SET organization_id = s.organization_id
FROM accounts.subscriptions s WHERE x.subscription_id = s.id AND x.organization_id IS NULL;
UPDATE accounts.product_access_grants x SET organization_id = s.organization_id
FROM accounts.subscriptions s WHERE x.subscription_id = s.id AND x.organization_id IS NULL;

UPDATE accounts.subscription_items x SET organization_id = po.organization_id
FROM accounts.purchase_orders po WHERE x.purchase_order_id = po.id AND x.organization_id IS NULL;

UPDATE accounts.support_ticket_messages x SET organization_id = t.organization_id
FROM accounts.support_tickets t WHERE x.ticket_id = t.id AND x.organization_id IS NULL;

-- Performance indexes (organization_id leading)
CREATE INDEX IF NOT EXISTS idx_quotations_organization_id ON accounts.quotations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_organization_id ON accounts.payments(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_active_products_organization_id ON accounts.active_products(organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_organization_id ON accounts.lead_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_partner_commission_entries_organization_id
  ON accounts.partner_commission_entries(organization_id);

-- 4) Triggers: stamp organization_id from parent when omitted (keeps legacy inserts working)
CREATE OR REPLACE FUNCTION accounts.tg_stamp_org_from_lead()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.lead_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM accounts.leads WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION accounts.tg_stamp_org_from_quotation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.quotation_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM accounts.quotations WHERE id = NEW.quotation_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION accounts.tg_stamp_org_from_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.subscription_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM accounts.subscriptions WHERE id = NEW.subscription_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION accounts.tg_stamp_org_from_purchase_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.purchase_order_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM accounts.purchase_orders WHERE id = NEW.purchase_order_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION accounts.tg_stamp_org_from_ticket()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.ticket_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM accounts.support_tickets WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  CREATE TRIGGER trg_lead_assignments_org
    BEFORE INSERT ON accounts.lead_assignments
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_lead();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_additional_addresses_org
    BEFORE INSERT ON accounts.additional_addresses
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_lead();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_branches_org
    BEFORE INSERT ON accounts.branches
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_lead();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_quote_sessions_org
    BEFORE INSERT ON accounts.quote_sessions
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_lead();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_quotations_org
    BEFORE INSERT ON accounts.quotations
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_lead();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_product_assignments_org
    BEFORE INSERT ON accounts.product_assignments
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_lead();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_active_products_org
    BEFORE INSERT ON accounts.active_products
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_lead();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_partner_commission_entries_org
    BEFORE INSERT ON accounts.partner_commission_entries
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_lead();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_product_summary_items_org
    BEFORE INSERT ON accounts.product_summary_items
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_quotation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_quotation_invoices_org
    BEFORE INSERT ON accounts.quotation_invoices
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_quotation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_payments_org
    BEFORE INSERT ON accounts.payments
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_quotation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_quotation_branch_payments_org
    BEFORE INSERT ON accounts.quotation_branch_payments
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_quotation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_payment_webhook_events_org
    BEFORE INSERT ON accounts.payment_webhook_events
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_quotation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_subscription_entitlements_org
    BEFORE INSERT ON accounts.subscription_entitlements
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_subscription();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_usage_metrics_org
    BEFORE INSERT ON accounts.usage_metrics
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_subscription();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_renewal_events_org
    BEFORE INSERT ON accounts.renewal_events
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_subscription();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_subscription_invoices_org
    BEFORE INSERT ON accounts.subscription_invoices
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_subscription();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_product_access_grants_org
    BEFORE INSERT ON accounts.product_access_grants
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_subscription();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_subscription_items_org
    BEFORE INSERT ON accounts.subscription_items
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_purchase_order();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER trg_support_ticket_messages_org
    BEFORE INSERT ON accounts.support_ticket_messages
    FOR EACH ROW EXECUTE PROCEDURE accounts.tg_stamp_org_from_ticket();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Product registry in platform
CREATE TABLE IF NOT EXISTS platform.products (
  id VARCHAR(64) PRIMARY KEY,
  schema_name VARCHAR(64) NOT NULL UNIQUE,
  label VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform.products (id, schema_name, label) VALUES
  ('contact-center', 'ccass', 'AI-Native Contact Center as a Service'),
  ('crm', 'crm', 'AI Native CRM'),
  ('cdp', 'cdp', 'Cognitive Customer Data Platform'),
  ('campaign', 'campaign', 'AI Native Campaign Management'),
  ('value-management', 'cvm', 'AI Native Customer Value Management'),
  ('ticketing', 'ticketing', 'AI Native Ticketing System'),
  ('accounts', 'accounts', 'My Accounts')
ON CONFLICT (id) DO UPDATE SET
  schema_name = EXCLUDED.schema_name,
  label = EXCLUDED.label;
