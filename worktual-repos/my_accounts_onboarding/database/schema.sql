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
  domain_id VARCHAR(16) NOT NULL UNIQUE,
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_quotations_lead_id ON quotations(lead_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);

CREATE TABLE IF NOT EXISTS product_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL,
  branch_id VARCHAR(128) NOT NULL,
  billing_target_id VARCHAR(128) NOT NULL,
  change_type VARCHAR(32),
  config JSONB
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
  billing_target_id VARCHAR(64),
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
  billing_target_id VARCHAR(128) NOT NULL,
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
  domain_id VARCHAR(16) NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_organizations_domain_id ON organizations(domain_id);
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
  location_id VARCHAR(128) NOT NULL,
  billing_target_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  change_type VARCHAR(32) NOT NULL DEFAULT 'new',
  entitlement_config JSONB,
  price_label VARCHAR(128),
  implementation_purchased BOOLEAN NOT NULL DEFAULT FALSE,
  mrr NUMERIC(14, 2),
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
  location_id VARCHAR(128) NOT NULL,
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
  location_id VARCHAR(128),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
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
  domain_id VARCHAR(16),
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
  domain_id VARCHAR(16),
  company_name VARCHAR(255),
  contact_email VARCHAR(255),
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
  location_id VARCHAR(128) NOT NULL,
  product_id VARCHAR(64),
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'submitted',
  trigger_source VARCHAR(32) NOT NULL DEFAULT 'customer',
  grace_deadline_at TIMESTAMPTZ,
  related_quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
  customer_note TEXT,
  admin_note TEXT,
  domain_id VARCHAR(16),
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
CREATE INDEX IF NOT EXISTS idx_branch_cancellation_requests_organization_id ON branch_cancellation_requests(organization_id, location_id);
CREATE INDEX IF NOT EXISTS idx_branch_cancellation_requests_subscription_id ON branch_cancellation_requests(subscription_id);

CREATE TABLE IF NOT EXISTS branch_cancellation_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type VARCHAR(32) NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id VARCHAR(128) NOT NULL,
  product_id VARCHAR(64),
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
  grace_deadline_at TIMESTAMPTZ NOT NULL,
  request_id UUID REFERENCES branch_cancellation_requests(id) ON DELETE SET NULL,
  alerted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (alert_type, subscription_id, grace_deadline_at),
  UNIQUE (alert_type, quotation_id, location_id, product_id, grace_deadline_at)
);

CREATE INDEX IF NOT EXISTS idx_branch_cancellation_alerts_request_id ON branch_cancellation_alerts(request_id);

-- Microsoft Graph OAuth mail connections (per signed-in account)
CREATE TABLE IF NOT EXISTS mail_oauth_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type VARCHAR(16) NOT NULL DEFAULT 'internal',
  account_id UUID NOT NULL,
  mailbox_profile VARCHAR(16) NOT NULL,
  account_email VARCHAR(255) NOT NULL,
  account_name VARCHAR(255),
  ms_tenant_id VARCHAR(64),
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT,
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
  mailbox_profile VARCHAR(16) NOT NULL,
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
  mailbox_profile VARCHAR(16) NOT NULL,
  resource TEXT NOT NULL,
  client_state VARCHAR(128),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_graph_mail_subscriptions_expires_at ON graph_mail_subscriptions(expires_at);

-- Customer setup workspace (Organization)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_type VARCHAR(64);
ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS city VARCHAR(128);
ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS timezone VARCHAR(64);

CREATE TABLE IF NOT EXISTS setup_holiday_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  country VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_setup_holiday_calendars_org ON setup_holiday_calendars(organization_id);

CREATE TABLE IF NOT EXISTS setup_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES setup_holiday_calendars(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  holiday_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_setup_holidays_calendar ON setup_holidays(calendar_id);

CREATE TABLE IF NOT EXISTS setup_business_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  timezone VARCHAR(64),
  open_time TIME NOT NULL DEFAULT '09:00',
  close_time TIME NOT NULL DEFAULT '22:00',
  working_days JSONB NOT NULL DEFAULT '["Monday","Tuesday","Wednesday","Thursday","Friday"]'::jsonb,
  holiday_calendar_id UUID REFERENCES setup_holiday_calendars(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE setup_business_hours ADD COLUMN IF NOT EXISTS open_time TIME;
ALTER TABLE setup_business_hours ADD COLUMN IF NOT EXISTS close_time TIME;
ALTER TABLE setup_business_hours ADD COLUMN IF NOT EXISTS working_days JSONB;
UPDATE setup_business_hours SET open_time = '09:00' WHERE open_time IS NULL;
UPDATE setup_business_hours SET close_time = '22:00' WHERE close_time IS NULL;
UPDATE setup_business_hours
SET working_days = '["Monday","Tuesday","Wednesday","Thursday","Friday"]'::jsonb
WHERE working_days IS NULL;
CREATE INDEX IF NOT EXISTS idx_setup_business_hours_org ON setup_business_hours(organization_id);

CREATE TABLE IF NOT EXISTS setup_business_hour_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_hours_id UUID NOT NULL REFERENCES setup_business_hours(id) ON DELETE CASCADE,
  shift_type VARCHAR(32) NOT NULL DEFAULT 'Regular',
  day_of_week VARCHAR(16) NOT NULL,
  end_day_of_week VARCHAR(16),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_start_time TIME,
  break_end_time TIME,
  break_start_time_2 TIME,
  break_end_time_2 TIME,
  crosses_midnight BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE setup_business_hour_shifts ADD COLUMN IF NOT EXISTS end_day_of_week VARCHAR(16);
ALTER TABLE setup_business_hour_shifts ADD COLUMN IF NOT EXISTS break_start_time TIME;
ALTER TABLE setup_business_hour_shifts ADD COLUMN IF NOT EXISTS break_end_time TIME;
ALTER TABLE setup_business_hour_shifts ADD COLUMN IF NOT EXISTS break_start_time_2 TIME;
ALTER TABLE setup_business_hour_shifts ADD COLUMN IF NOT EXISTS break_end_time_2 TIME;
CREATE INDEX IF NOT EXISTS idx_setup_bh_shifts_bh ON setup_business_hour_shifts(business_hours_id);

CREATE TABLE IF NOT EXISTS setup_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  business_hours_id UUID REFERENCES setup_business_hours(id) ON DELETE SET NULL,
  member_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  available_products JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE setup_teams ADD COLUMN IF NOT EXISTS member_ids JSONB;
UPDATE setup_teams SET member_ids = '[]'::jsonb WHERE member_ids IS NULL;
CREATE INDEX IF NOT EXISTS idx_setup_teams_org ON setup_teams(organization_id);

CREATE TABLE IF NOT EXISTS setup_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  product_id VARCHAR(128),
  accessible_products JSONB NOT NULL DEFAULT '[]'::jsonb,
  module_permission VARCHAR(128),
  can_view BOOLEAN NOT NULL DEFAULT TRUE,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  can_export BOOLEAN NOT NULL DEFAULT FALSE,
  can_approve BOOLEAN NOT NULL DEFAULT FALSE,
  module_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE setup_roles ADD COLUMN IF NOT EXISTS product_id VARCHAR(128);
ALTER TABLE setup_roles ADD COLUMN IF NOT EXISTS module_permissions JSONB;
UPDATE setup_roles SET module_permissions = '[]'::jsonb WHERE module_permissions IS NULL;
UPDATE setup_roles
SET product_id = accessible_products->>0
WHERE product_id IS NULL
  AND jsonb_typeof(accessible_products) = 'array'
  AND jsonb_array_length(accessible_products) = 1;
CREATE INDEX IF NOT EXISTS idx_setup_roles_org ON setup_roles(organization_id);
-- Keep one role per org/product/name (earliest), then enforce uniqueness.
DELETE FROM setup_roles
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY organization_id, product_id, lower(name)
             ORDER BY created_at ASC, id ASC
           ) AS rn
    FROM setup_roles
    WHERE product_id IS NOT NULL AND coalesce(name, '') <> ''
  ) ranked
  WHERE rn > 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_setup_roles_org_product_name
  ON setup_roles (organization_id, product_id, lower(name));

CREATE TABLE IF NOT EXISTS setup_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id VARCHAR(64),
  first_name VARCHAR(128) NOT NULL,
  last_name VARCHAR(128) NOT NULL,
  work_email VARCHAR(255) NOT NULL,
  mobile_number VARCHAR(32),
  team_id UUID REFERENCES setup_teams(id) ON DELETE SET NULL,
  business_hours_id UUID REFERENCES setup_business_hours(id) ON DELETE SET NULL,
  shift_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  primary_language VARCHAR(64),
  secondary_language VARCHAR(64),
  skill TEXT,
  location_id VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  password_hash TEXT,
  invite_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  password_set_at TIMESTAMPTZ,
  invited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE setup_users ADD COLUMN IF NOT EXISTS team_id UUID;
ALTER TABLE setup_users ADD COLUMN IF NOT EXISTS business_hours_id UUID;
ALTER TABLE setup_users ADD COLUMN IF NOT EXISTS shift_types JSONB;
ALTER TABLE setup_users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE setup_users ADD COLUMN IF NOT EXISTS invite_status VARCHAR(32);
ALTER TABLE setup_users ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;
ALTER TABLE setup_users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
UPDATE setup_users SET shift_types = '[]'::jsonb WHERE shift_types IS NULL;
UPDATE setup_users SET invite_status = 'pending' WHERE invite_status IS NULL;
CREATE INDEX IF NOT EXISTS idx_setup_users_org ON setup_users(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_setup_users_org_email ON setup_users(organization_id, lower(work_email));

CREATE TABLE IF NOT EXISTS setup_user_invite_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES setup_users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_setup_user_invite_tokens_user ON setup_user_invite_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_setup_user_invite_tokens_expires ON setup_user_invite_tokens(expires_at);

CREATE TABLE IF NOT EXISTS setup_user_product_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES setup_users(id) ON DELETE CASCADE,
  product_id VARCHAR(128) NOT NULL,
  role_id UUID NOT NULL REFERENCES setup_roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_setup_user_product_access_org ON setup_user_product_access(organization_id);
CREATE INDEX IF NOT EXISTS idx_setup_user_product_access_user ON setup_user_product_access(user_id);
CREATE INDEX IF NOT EXISTS idx_setup_user_product_access_role ON setup_user_product_access(role_id);

CREATE TABLE IF NOT EXISTS setup_channel_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_type VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_setup_channel_configs_org ON setup_channel_configs(organization_id);
CREATE INDEX IF NOT EXISTS idx_setup_channel_configs_type ON setup_channel_configs(organization_id, channel_type);

CREATE TABLE IF NOT EXISTS setup_email_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_config_id UUID NOT NULL UNIQUE REFERENCES setup_channel_configs(id) ON DELETE CASCADE,
  provider_type VARCHAR(32) NOT NULL,
  third_party_mode VARCHAR(32),
  oauth_provider VARCHAR(32),
  ccaas_handler VARCHAR(32),
  sender_email VARCHAR(255),
  sender_name VARCHAR(255),
  reply_to VARCHAR(255),
  domain VARCHAR(255),
  domain_verification_status VARCHAR(32),
  domain_verification_token VARCHAR(128),
  smtp_host VARCHAR(255),
  smtp_port INTEGER,
  smtp_secure BOOLEAN,
  imap_host VARCHAR(255),
  imap_port INTEGER,
  imap_secure BOOLEAN,
  smtp_user_encrypted TEXT,
  smtp_pass_encrypted TEXT,
  imap_user_encrypted TEXT,
  imap_pass_encrypted TEXT,
  oauth_connection_id UUID REFERENCES mail_oauth_connections(id) ON DELETE SET NULL,
  requested_local_part VARCHAR(128),
  hosted_domain VARCHAR(255) NOT NULL DEFAULT 'vectone.tech',
  provisioning_status VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_setup_email_configs_channel ON setup_email_configs(channel_config_id);

CREATE TABLE IF NOT EXISTS setup_webchat_configs (
  channel_config_id UUID PRIMARY KEY REFERENCES setup_channel_configs(id) ON DELETE CASCADE,
  webchat_id VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  alias_title VARCHAR(255) NOT NULL,
  description TEXT,
  greeting_message TEXT NOT NULL,
  trigger_message TEXT,
  personalisation JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_setup_webchat_configs_webchat_id ON setup_webchat_configs(webchat_id);

-- Phase 2: CCaaS queue routing (schema only; UI wired later)
CREATE TABLE IF NOT EXISTS setup_ccaas_queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  team_id UUID NOT NULL REFERENCES setup_teams(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_setup_ccaas_queues_org ON setup_ccaas_queues(organization_id);

CREATE TABLE IF NOT EXISTS setup_ccaas_queue_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES setup_ccaas_queues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL UNIQUE REFERENCES setup_users(id) ON DELETE CASCADE,
  handles_calls BOOLEAN NOT NULL DEFAULT FALSE,
  call_type VARCHAR(16) NOT NULL DEFAULT 'both',
  handles_email BOOLEAN NOT NULL DEFAULT FALSE,
  handles_chat BOOLEAN NOT NULL DEFAULT FALSE,
  handles_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  handles_instagram BOOLEAN NOT NULL DEFAULT FALSE,
  handles_facebook BOOLEAN NOT NULL DEFAULT FALSE,
  email_concurrency INTEGER NOT NULL DEFAULT 1,
  chat_concurrency INTEGER NOT NULL DEFAULT 1,
  whatsapp_concurrency INTEGER NOT NULL DEFAULT 1,
  instagram_concurrency INTEGER NOT NULL DEFAULT 1,
  facebook_concurrency INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS setup_crm_channel_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_config_id UUID NOT NULL REFERENCES setup_channel_configs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES setup_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_config_id, user_id)
);

CREATE TABLE IF NOT EXISTS setup_knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category VARCHAR(64) NOT NULL,
  file_name VARCHAR(512) NOT NULL,
  file_type VARCHAR(32) NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  all_branches BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_branch_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_setup_knowledge_docs_org ON setup_knowledge_documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_setup_knowledge_docs_category ON setup_knowledge_documents(organization_id, category);
