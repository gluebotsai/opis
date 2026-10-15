CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  display_name VARCHAR(255),
  phone VARCHAR(64),
  country VARCHAR(128),
  mobile_country_code VARCHAR(8),
  mobile_number VARCHAR(32),
  department VARCHAR(128),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token VARCHAR(128) PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  display_name VARCHAR(255),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(16) NOT NULL UNIQUE,
  company_name VARCHAR(255),
  industry_type VARCHAR(128),
  business_type VARCHAR(32),
  contact_name VARCHAR(255),
  designation VARCHAR(128),
  work_email VARCHAR(255),
  admin_email VARCHAR(255),
  tax_number VARCHAR(64),
  billing_address TEXT,
  website_url VARCHAR(512),
  country VARCHAR(128),
  state VARCHAR(128),
  company_size VARCHAR(64),
  is_decision_maker BOOLEAN NOT NULL DEFAULT TRUE,
  decision_maker_name VARCHAR(255),
  mobile_country_code VARCHAR(8),
  mobile_number VARCHAR(32),
  secondary_mobile_country_code VARCHAR(8),
  secondary_mobile_number VARCHAR(32),
  status VARCHAR(64) NOT NULL DEFAULT 'New',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  product_draft JSONB,
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lead_kind VARCHAR(32) NOT NULL DEFAULT 'standard'
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

CREATE TABLE IF NOT EXISTS lead_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead_id ON lead_assignments(lead_id);

CREATE TABLE IF NOT EXISTS additional_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  label VARCHAR(128),
  address TEXT,
  country VARCHAR(128),
  state VARCHAR(128),
  tax_number VARCHAR(64),
  industry_type VARCHAR(128),
  business_type VARCHAR(32),
  company_size VARCHAR(64),
  website_url VARCHAR(512),
  contact_name VARCHAR(255),
  designation VARCHAR(128),
  work_email VARCHAR(255),
  mobile_country_code VARCHAR(8),
  mobile_number VARCHAR(32),
  secondary_mobile_country_code VARCHAR(8),
  secondary_mobile_number VARCHAR(32)
);

CREATE INDEX IF NOT EXISTS idx_additional_addresses_lead_id ON additional_addresses(lead_id);

CREATE TABLE IF NOT EXISTS branches (
  id VARCHAR(128) NOT NULL,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  label VARCHAR(128),
  address TEXT,
  country VARCHAR(128),
  state VARCHAR(128),
  tax_number VARCHAR(64),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (lead_id, id)
);

CREATE TABLE IF NOT EXISTS quote_sessions (
  lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  lead_snapshot JSONB,
  file_name VARCHAR(255),
  pdf_base64 TEXT,
  assignments JSONB NOT NULL DEFAULT '[]'::jsonb,
  product_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  invoices JSONB NOT NULL DEFAULT '[]'::jsonb,
  invoice_mode VARCHAR(32),
  branch_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  lead_snapshot JSONB,
  file_name VARCHAR(255),
  pdf_base64 TEXT,
  invoice_mode VARCHAR(32),
  branch_summary JSONB,
  subtotal NUMERIC(14, 2),
  grand_total NUMERIC(14, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  gst_rate NUMERIC(6, 4),
  status VARCHAR(64) NOT NULL,
  finance_note TEXT,
  submitted_by VARCHAR(255),
  submitted_at TIMESTAMPTZ,
  reviewed_by VARCHAR(255),
  reviewed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  submission_batch_id UUID,
  source_product_request_id UUID,
  billing_phase VARCHAR(32) NOT NULL DEFAULT 'standard',
  invoice_number VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS invoice_company_settings (
  id VARCHAR(32) PRIMARY KEY DEFAULT 'default',
  invoice_prefix VARCHAR(32) NOT NULL DEFAULT 'WIPL',
  series_year INT,
  next_sequence INT NOT NULL DEFAULT 1,
  account_name TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  ifsc TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  purchase_cutoff_day INT NOT NULL DEFAULT 20,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO invoice_company_settings (id, invoice_prefix, series_year, next_sequence)
VALUES ('default', 'WIPL', EXTRACT(YEAR FROM NOW())::INT, 1)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_quotations_lead_id ON quotations(lead_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
CREATE INDEX IF NOT EXISTS idx_quotations_billing_phase ON quotations(billing_phase);

CREATE TABLE IF NOT EXISTS product_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL,
  branch_id VARCHAR(128) NOT NULL,
  billing_branch_id VARCHAR(128) NOT NULL,
  change_type VARCHAR(32),
  config JSONB,
  agent_count INTEGER,
  included_number_count INTEGER,
  queue_capacity_count INTEGER,
  total_number_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_product_assignments_quotation_id ON product_assignments(quotation_id);

CREATE TABLE IF NOT EXISTS product_summary_items (
  id SERIAL PRIMARY KEY,
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id VARCHAR(64),
  name VARCHAR(255),
  price_label VARCHAR(128),
  branch_label VARCHAR(255),
  billing_label VARCHAR(255),
  change_type_label VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_product_summary_items_quotation_id ON product_summary_items(quotation_id);

CREATE TABLE IF NOT EXISTS quotation_invoices (
  id SERIAL PRIMARY KEY,
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  file_name VARCHAR(255),
  pdf_base64 TEXT,
  billing_branch_id VARCHAR(64),
  branch_label VARCHAR(255),
  subtotal NUMERIC(14, 2),
  grand_total NUMERIC(14, 2)
);

CREATE INDEX IF NOT EXISTS idx_quotation_invoices_quotation_id ON quotation_invoices(quotation_id);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  quotation_id UUID NOT NULL UNIQUE REFERENCES quotations(id) ON DELETE CASCADE,
  provider VARCHAR(32),
  payment_link_url TEXT,
  payment_link_id VARCHAR(255),
  subtotal NUMERIC(14, 2),
  grand_total NUMERIC(14, 2),
  currency VARCHAR(8),
  gst_rate NUMERIC(6, 4),
  amount_label VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  provider_payment_id VARCHAR(255),
  provider_customer_id VARCHAR(255),
  last_provider_event_id VARCHAR(255),
  failure_reason TEXT,
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS quotation_branch_payments (
  id SERIAL PRIMARY KEY,
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  billing_branch_id VARCHAR(64) NOT NULL,
  branch_label VARCHAR(255),
  provider VARCHAR(32),
  payment_link_url TEXT,
  payment_link_id VARCHAR(255) UNIQUE,
  subtotal NUMERIC(14, 2),
  grand_total NUMERIC(14, 2),
  currency VARCHAR(8),
  amount_label VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  payment_reported_at TIMESTAMPTZ,
  payment_reported_by VARCHAR(255),
  finance_confirmed_at TIMESTAMPTZ,
  finance_confirmed_by VARCHAR(255),
  provider_payment_id VARCHAR(255),
  provider_customer_id VARCHAR(255),
  last_provider_event_id VARCHAR(255),
  failure_reason TEXT,
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ,
  UNIQUE (quotation_id, billing_branch_id)
);

CREATE INDEX IF NOT EXISTS idx_quotation_branch_payments_quotation_id ON quotation_branch_payments(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quotation_branch_payments_payment_link_id ON quotation_branch_payments(payment_link_id);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  provider VARCHAR(32) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(128),
  quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
  payload JSONB,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE IF NOT EXISTS active_products (
  key VARCHAR(160) PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL,
  branch_id VARCHAR(128) NOT NULL,
  billing_branch_id VARCHAR(128) NOT NULL,
  change_type VARCHAR(32),
  config JSONB,
  implementation_purchased BOOLEAN NOT NULL DEFAULT FALSE,
  price_label VARCHAR(128),
  quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  payment_confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_active_products_lead_id ON active_products(lead_id);

CREATE TABLE IF NOT EXISTS pricing_catalogs (
  version INTEGER PRIMARY KEY,
  updated_at TIMESTAMPTZ,
  updated_by VARCHAR(255),
  regions JSONB,
  shared JSONB,
  products JSONB,
  region_pricing JSONB
);

CREATE TABLE IF NOT EXISTS export_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exported_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  exported_by_email VARCHAR(255) NOT NULL,
  exported_by_role VARCHAR(32) NOT NULL,
  agent_user_id UUID,
  agent_email VARCHAR(255),
  agent_name VARCHAR(255),
  format VARCHAR(32) NOT NULL,
  scope VARCHAR(32) NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  file_name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_export_audit_logs_created_at ON export_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_audit_logs_agent_user_id ON export_audit_logs(agent_user_id);

-- Customer hub: organizations (converted from leads on first paid purchase)
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_lead_id UUID NOT NULL UNIQUE REFERENCES leads(id) ON DELETE RESTRICT,
  tenant_id VARCHAR(16) NOT NULL,
  company_name VARCHAR(255),
  industry_type VARCHAR(128),
  contact_name VARCHAR(255),
  designation VARCHAR(128),
  work_email VARCHAR(255),
  admin_email VARCHAR(255),
  tax_number VARCHAR(64),
  billing_address TEXT,
  website_url VARCHAR(512),
  country VARCHAR(128),
  company_size VARCHAR(64),
  mobile_country_code VARCHAR(8),
  mobile_number VARCHAR(32),
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'active',
  converted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_tenant_id ON organizations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_organizations_lifecycle_status ON organizations(lifecycle_status);

CREATE TABLE IF NOT EXISTS organization_locations (
  id VARCHAR(128) NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label VARCHAR(128),
  address TEXT,
  country VARCHAR(128),
  tax_number VARCHAR(64),
  contact_name VARCHAR(255),
  designation VARCHAR(128),
  work_email VARCHAR(255),
  industry_type VARCHAR(128),
  mobile_country_code VARCHAR(8),
  mobile_number VARCHAR(32),
  secondary_mobile_country_code VARCHAR(8),
  secondary_mobile_number VARCHAR(32),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  inactivated_at TIMESTAMPTZ,
  inactivated_by VARCHAR(255),
  inactivation_reason TEXT,
  scheduled_drop_at TIMESTAMPTZ,
  scheduled_drop_request_id UUID,
  scheduled_drop_by VARCHAR(255),
  scheduled_drop_reason TEXT,
  PRIMARY KEY (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_organization_locations_org_id ON organization_locations(organization_id);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS converted_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_converted_organization_id ON leads(converted_organization_id);

-- Subscriptions: live product entitlements per organization + location
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(160) NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  product_id VARCHAR(64) NOT NULL,
  branch_id VARCHAR(128) NOT NULL,
  billing_branch_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  change_type VARCHAR(32) NOT NULL DEFAULT 'new',
  entitlement_config JSONB,
  price_label VARCHAR(128),
  implementation_purchased BOOLEAN NOT NULL DEFAULT FALSE,
  mrr NUMERIC(14, 2),
  agent_count INTEGER NOT NULL DEFAULT 0,
  included_number_count INTEGER NOT NULL DEFAULT 0,
  queue_capacity_count INTEGER NOT NULL DEFAULT 0,
  total_number_count INTEGER NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ,
  renews_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  payment_confirmed_at TIMESTAMPTZ,
  quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
  source_purchase_order_id UUID,
  cancelled_at TIMESTAMPTZ,
  cancelled_by VARCHAR(255),
  cancellation_reason TEXT,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  cancel_effective_at TIMESTAMPTZ,
  scheduled_cancellation_request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_organization_id ON subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_product_id ON subscriptions(product_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_renews_at ON subscriptions(renews_at);

CREATE TABLE IF NOT EXISTS subscription_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  config JSONB NOT NULL,
  change_type VARCHAR(32) NOT NULL DEFAULT 'new',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  purchase_order_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_entitlements_subscription_id ON subscription_entitlements(subscription_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  quotation_id UUID NOT NULL UNIQUE REFERENCES quotations(id) ON DELETE RESTRICT,
  status VARCHAR(32) NOT NULL DEFAULT 'paid',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_organization_id ON purchase_orders(organization_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_lead_id ON purchase_orders(lead_id);

CREATE TABLE IF NOT EXISTS subscription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  product_id VARCHAR(64) NOT NULL,
  branch_id VARCHAR(128) NOT NULL,
  change_type VARCHAR(32) NOT NULL DEFAULT 'new',
  config_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_items_purchase_order_id ON subscription_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_subscription_items_subscription_id ON subscription_items(subscription_id);

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_source_purchase_order_id_fkey;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_source_purchase_order_id_fkey
  FOREIGN KEY (source_purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;

ALTER TABLE subscription_entitlements
  DROP CONSTRAINT IF EXISTS subscription_entitlements_purchase_order_id_fkey;

ALTER TABLE subscription_entitlements
  ADD CONSTRAINT subscription_entitlements_purchase_order_id_fkey
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;

-- Customer portal users (separate from internal Worktual users)
CREATE TABLE IF NOT EXISTS customer_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  role VARCHAR(32) NOT NULL DEFAULT 'branch_user',
  branch_id VARCHAR(128),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_customer_users_organization_id ON customer_users(organization_id);
CREATE INDEX IF NOT EXISTS idx_customer_users_email ON customer_users(email);

CREATE TABLE IF NOT EXISTS customer_auth_sessions (
  token VARCHAR(128) PRIMARY KEY,
  customer_user_id UUID NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_auth_sessions_user_id ON customer_auth_sessions(customer_user_id);
CREATE INDEX IF NOT EXISTS idx_customer_auth_sessions_expires_at ON customer_auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS product_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id UUID NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_user_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_product_access_grants_customer_user_id ON product_access_grants(customer_user_id);
CREATE INDEX IF NOT EXISTS idx_product_access_grants_subscription_id ON product_access_grants(subscription_id);

CREATE TABLE IF NOT EXISTS usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  metric_key VARCHAR(64) NOT NULL,
  allocated NUMERIC(14, 2) NOT NULL DEFAULT 0,
  consumed NUMERIC(14, 2) NOT NULL DEFAULT 0,
  unit VARCHAR(32),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subscription_id, metric_key, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_metrics_subscription_id ON usage_metrics(subscription_id);
CREATE INDEX IF NOT EXISTS idx_usage_metrics_period ON usage_metrics(period_start, period_end);

CREATE TABLE IF NOT EXISTS product_go_live (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL,
  branch_id VARCHAR(128) NOT NULL,
  billing_branch_id VARCHAR(128) NOT NULL DEFAULT 'hq',
  lifecycle_status VARCHAR(64) NOT NULL DEFAULT 'awaiting_implementation',
  otc_quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
  go_live_quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  uat_expires_at TIMESTAMPTZ,
  uat_extended_count INTEGER NOT NULL DEFAULT 0,
  uat_credentials JSONB,
  change_request_note TEXT,
  accepted_at TIMESTAMPTZ,
  go_live_paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, product_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_product_go_live_lead_id ON product_go_live(lead_id);
CREATE INDEX IF NOT EXISTS idx_product_go_live_org_id ON product_go_live(organization_id);
CREATE INDEX IF NOT EXISTS idx_product_go_live_status ON product_go_live(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_product_go_live_uat_expires ON product_go_live(uat_expires_at);

CREATE TABLE IF NOT EXISTS usage_metrics_monthly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  product_id VARCHAR(64),
  branch_id VARCHAR(128),
  year_month CHAR(7) NOT NULL,
  metric_key VARCHAR(64) NOT NULL,
  allocated NUMERIC(14, 2) NOT NULL DEFAULT 0,
  consumed NUMERIC(14, 2) NOT NULL DEFAULT 0,
  unit VARCHAR(32),
  snapshot JSONB,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subscription_id, metric_key, year_month)
);

CREATE INDEX IF NOT EXISTS idx_usage_metrics_monthly_org ON usage_metrics_monthly(organization_id);
CREATE INDEX IF NOT EXISTS idx_usage_metrics_monthly_ym ON usage_metrics_monthly(year_month);

CREATE TABLE IF NOT EXISTS renewal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
  renewal_quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_renewal_events_subscription_id ON renewal_events(subscription_id);
CREATE INDEX IF NOT EXISTS idx_renewal_events_due_at ON renewal_events(due_at);
CREATE INDEX IF NOT EXISTS idx_renewal_events_status ON renewal_events(status);

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  sequence SMALLINT NOT NULL CHECK (sequence IN (1, 2)),
  invoice_type VARCHAR(32) NOT NULL,
  generation_date DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'generated',
  service_period_start DATE NOT NULL,
  service_period_end DATE NOT NULL,
  remaining_days INTEGER,
  monthly_price NUMERIC(14, 2) NOT NULL,
  subtotal NUMERIC(14, 2) NOT NULL,
  gst_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.18,
  grand_total NUMERIC(14, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subscription_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_subscription_invoices_subscription_id ON subscription_invoices(subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_invoices_status_generation_date ON subscription_invoices(status, generation_date);

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number VARCHAR(32) NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_user_id UUID NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  product_id VARCHAR(64),
  subscription_key VARCHAR(160),
  product_label VARCHAR(255),
  category VARCHAR(128) NOT NULL,
  priority VARCHAR(32) NOT NULL DEFAULT 'medium',
  subject VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  unable_to_use BOOLEAN NOT NULL DEFAULT FALSE,
  started_after_change BOOLEAN NOT NULL DEFAULT FALSE,
  tenant_id VARCHAR(16),
  company_name VARCHAR(255),
  contact_email VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_organization_id ON support_tickets(organization_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at DESC);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_type VARCHAR(32) NOT NULL,
  author_label VARCHAR(255),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_id ON support_ticket_messages(ticket_id);

CREATE TABLE IF NOT EXISTS customer_product_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number VARCHAR(32) NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_user_id UUID NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
  source_lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  request_type VARCHAR(32) NOT NULL DEFAULT 'new',
  status VARCHAR(32) NOT NULL DEFAULT 'submitted',
  assignments JSONB NOT NULL DEFAULT '[]'::jsonb,
  product_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  branch_summary JSONB,
  customer_note TEXT,
  tenant_id VARCHAR(16),
  company_name VARCHAR(255),
  contact_email VARCHAR(255),
  new_branches JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_product_requests_organization_id ON customer_product_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_customer_product_requests_status ON customer_product_requests(status);
CREATE INDEX IF NOT EXISTS idx_customer_product_requests_created_at ON customer_product_requests(created_at DESC);

CREATE TABLE IF NOT EXISTS branch_cancellation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number VARCHAR(32) NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_user_id UUID REFERENCES customer_users(id) ON DELETE SET NULL,
  source_lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  request_kind VARCHAR(32) NOT NULL,
  branch_id VARCHAR(128) NOT NULL,
  product_id VARCHAR(64),
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'submitted',
  trigger_source VARCHAR(32) NOT NULL DEFAULT 'customer',
  grace_deadline_at TIMESTAMPTZ,
  related_quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
  customer_note TEXT,
  admin_note TEXT,
  tenant_id VARCHAR(16),
  company_name VARCHAR(255),
  contact_email VARCHAR(255),
  effective_timing VARCHAR(32) NOT NULL DEFAULT 'end_of_period',
  effective_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_branch_cancellation_requests_status ON branch_cancellation_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_branch_cancellation_requests_organization_id ON branch_cancellation_requests(organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_cancellation_requests_subscription_id ON branch_cancellation_requests(subscription_id);

CREATE TABLE IF NOT EXISTS branch_cancellation_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type VARCHAR(32) NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id VARCHAR(128) NOT NULL,
  product_id VARCHAR(64),
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
  grace_deadline_at TIMESTAMPTZ NOT NULL,
  request_id UUID REFERENCES branch_cancellation_requests(id) ON DELETE SET NULL,
  alerted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (alert_type, subscription_id, grace_deadline_at),
  UNIQUE (alert_type, quotation_id, branch_id, product_id, grace_deadline_at)
);

CREATE INDEX IF NOT EXISTS idx_branch_cancellation_alerts_request_id ON branch_cancellation_alerts(request_id);

CREATE TABLE IF NOT EXISTS branch_add_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number VARCHAR(64) NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  requested_by_customer_user_id UUID REFERENCES customer_users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'submitted',
  company_name VARCHAR(255) NOT NULL DEFAULT '',
  contact_email VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_branch_add_requests_organization ON branch_add_requests(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_branch_add_requests_lead ON branch_add_requests(source_lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_branch_add_requests_status ON branch_add_requests(status, created_at DESC);

-- Microsoft Graph OAuth mail connections (per signed-in account)
CREATE TABLE IF NOT EXISTS mail_oauth_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type VARCHAR(16) NOT NULL DEFAULT 'internal',
  account_id UUID NOT NULL,
  mailbox_profile VARCHAR(64) NOT NULL,
  account_email VARCHAR(255) NOT NULL,
  account_name VARCHAR(255),
  ms_tenant_id VARCHAR(64),
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT,
  needs_reauth BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_type, account_id, mailbox_profile)
);

CREATE INDEX IF NOT EXISTS idx_mail_oauth_connections_profile ON mail_oauth_connections(mailbox_profile);
CREATE INDEX IF NOT EXISTS idx_mail_oauth_connections_email ON mail_oauth_connections(account_email);

CREATE TABLE IF NOT EXISTS mail_oauth_states (
  state VARCHAR(128) PRIMARY KEY,
  account_type VARCHAR(16) NOT NULL DEFAULT 'internal',
  account_id UUID NOT NULL,
  mailbox_profile VARCHAR(64) NOT NULL,
  return_path VARCHAR(512) NOT NULL DEFAULT '/mail',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_oauth_states_expires_at ON mail_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type VARCHAR(64) NOT NULL,
  to_email VARCHAR(255),
  subject VARCHAR(512),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status);
CREATE INDEX IF NOT EXISTS idx_email_outbox_created_at ON email_outbox(created_at DESC);

CREATE TABLE IF NOT EXISTS graph_mail_subscriptions (
  subscription_id VARCHAR(128) PRIMARY KEY,
  mailbox_profile VARCHAR(64) NOT NULL,
  resource TEXT NOT NULL,
  client_state VARCHAR(128),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_graph_mail_subscriptions_expires_at ON graph_mail_subscriptions(expires_at);

CREATE TABLE IF NOT EXISTS mail_signatures (
  account_type VARCHAR(16) NOT NULL DEFAULT 'internal',
  account_id UUID NOT NULL,
  mailbox_profile VARCHAR(64) NOT NULL,
  html_body TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_type, account_id, mailbox_profile)
);

-- Resellers (billing partners)
CREATE TABLE IF NOT EXISTS resellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  designation VARCHAR(128),
  work_email VARCHAR(255) NOT NULL,
  invoice_email VARCHAR(255) NOT NULL,
  invoice_cc_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  tax_number VARCHAR(64),
  billing_address TEXT,
  country VARCHAR(128),
  website_url VARCHAR(512),
  mobile_country_code VARCHAR(8) DEFAULT '+91',
  mobile_number VARCHAR(32),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reseller_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id UUID NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reseller_auth_sessions (
  token VARCHAR(128) PRIMARY KEY,
  reseller_user_id UUID NOT NULL REFERENCES reseller_users(id) ON DELETE CASCADE,
  reseller_id UUID NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS reseller_id UUID REFERENCES resellers(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS reseller_id UUID REFERENCES resellers(id) ON DELETE SET NULL;

-- Referral partners (distinct from billing resellers)
CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  designation VARCHAR(128),
  work_email VARCHAR(255) NOT NULL,
  country VARCHAR(128),
  website_url VARCHAR(512),
  mobile_country_code VARCHAR(8) DEFAULT '+91',
  mobile_number VARCHAR(32),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_auth_sessions (
  token VARCHAR(128) PRIMARY KEY,
  partner_user_id UUID NOT NULL REFERENCES partner_users(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS commission_slabs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country VARCHAR(128) NOT NULL DEFAULT 'India',
  min_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  max_amount NUMERIC(14, 2),
  rate_percent NUMERIC(8, 4) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE commission_slabs ADD COLUMN IF NOT EXISTS country VARCHAR(128) NOT NULL DEFAULT 'India';

CREATE INDEX IF NOT EXISTS idx_commission_slabs_active ON commission_slabs(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_commission_slabs_country ON commission_slabs(country, is_active, sort_order);

CREATE TABLE IF NOT EXISTS partner_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  account_holder_name VARCHAR(255) NOT NULL,
  bank_name VARCHAR(255) NOT NULL DEFAULT '',
  account_number VARCHAR(64) NOT NULL DEFAULT '',
  ifsc_or_routing VARCHAR(64) NOT NULL DEFAULT '',
  branch_name VARCHAR(255),
  iban VARCHAR(64),
  swift_bic VARCHAR(32),
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_bank_accounts_partner_id ON partner_bank_accounts(partner_id);

CREATE TABLE IF NOT EXISTS partner_commission_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  deal_amount NUMERIC(14, 2) NOT NULL,
  slab_id UUID REFERENCES commission_slabs(id) ON DELETE SET NULL,
  rate_percent NUMERIC(8, 4) NOT NULL,
  commission_amount NUMERIC(14, 2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  accrued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  paid_by VARCHAR(255),
  payout_reference VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (quotation_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_commission_entries_partner_id ON partner_commission_entries(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_commission_entries_status ON partner_commission_entries(status);

CREATE TABLE IF NOT EXISTS password_reset_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  account_type VARCHAR(32) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  otp_hash TEXT NOT NULL,
  reset_token_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  reset_token_expires_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_email ON password_reset_otps(email);
CREATE INDEX IF NOT EXISTS idx_password_reset_otps_expires_at ON password_reset_otps(expires_at);
