import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { DEFAULT_PRICING_CATALOG } from "../../src/lib/pricingCatalogDefaults.js";
import { hashPassword } from "../users.js";
import { pool, query } from "./pool.js";
import { ensureUuid, env } from "./util.js";

async function repairActiveProductKeys() {
  await query(`ALTER TABLE active_products ALTER COLUMN key TYPE VARCHAR(160)`);

  await query(
    `UPDATE active_products ap
     SET quotation_id = NULL
     WHERE quotation_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM quotations q
         WHERE q.id = ap.quotation_id AND q.lead_id = ap.lead_id
       )`,
  );

  await query(
    `DELETE FROM active_products legacy
     WHERE legacy.key = legacy.product_id || ':' || legacy.branch_id
       AND EXISTS (
         SELECT 1 FROM active_products scoped
         WHERE scoped.key = legacy.lead_id::text || ':' || legacy.product_id || ':' || legacy.branch_id
       )`,
  );

  await query(
    `UPDATE active_products
     SET key = lead_id::text || ':' || product_id || ':' || branch_id
     WHERE key = product_id || ':' || branch_id`,
  );

  const { rows } = await query(
    `SELECT id FROM quotations WHERE status = ANY($1::text[])`,
    [["Approved", "Paid"]],
  );

  const { ensureActiveProductsForQuotation } = await import("../quotations.js");

  for (const row of rows) {
    try {
      await ensureActiveProductsForQuotation(row.id);
    } catch (error) {
      console.warn(
        `[db] active_products backfill skipped for quotation ${row.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const schemaFile = path.join(projectRoot, "database", "schema.sql");
const legacyDataDir = path.join(projectRoot, "server", "data");

function isTransientDatabaseStartupError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /recovery mode|the database system is starting|the database system is not yet accepting connections|connection terminated unexpectedly|ECONNREFUSED|ETIMEDOUT/i.test(
    message,
  );
}

async function waitForDatabaseReady({ timeoutMs = 120_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const { rows } = await pool.query("SELECT pg_is_in_recovery() AS recovering");
      if (rows[0]?.recovering === false) {
        return;
      }

      console.warn("[db] PostgreSQL is still in recovery mode — waiting...");
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseStartupError(error)) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[db] Database not ready yet (${message}) — waiting...`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw (
    lastError ||
    new Error(`Database did not become ready within ${Math.round(timeoutMs / 1000)}s`)
  );
}

async function runSchema() {
  const sql = fs.readFileSync(schemaFile, "utf8");
  await pool.query(sql);
}

async function runRoutines() {
  const routinesFile = path.join(projectRoot, "database", "routines.sql");
  if (!fs.existsSync(routinesFile)) {
    return;
  }

  const sql = fs.readFileSync(routinesFile, "utf8");
  await pool.query(sql);
}

async function repairSchema() {
  await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

  const repairs = [
    `ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid()`,
    `ALTER TABLE users ALTER COLUMN is_active SET DEFAULT TRUE`,
    `ALTER TABLE users ALTER COLUMN created_at SET DEFAULT NOW()`,
    `ALTER TABLE users ALTER COLUMN updated_at SET DEFAULT NOW()`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(128)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_country_code VARCHAR(8)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(32)`,
    `ALTER TABLE leads ALTER COLUMN id SET DEFAULT gen_random_uuid()`,
    `ALTER TABLE leads ALTER COLUMN status SET DEFAULT 'New'`,
    `ALTER TABLE leads ALTER COLUMN is_active SET DEFAULT TRUE`,
    `ALTER TABLE leads ALTER COLUMN created_at SET DEFAULT NOW()`,
    `ALTER TABLE leads ALTER COLUMN updated_at SET DEFAULT NOW()`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS country VARCHAR(128)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_size VARCHAR(64)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_decision_maker BOOLEAN NOT NULL DEFAULT TRUE`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS decision_maker_name VARCHAR(255)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_type VARCHAR(32)`,
    `ALTER TABLE additional_addresses ALTER COLUMN id SET DEFAULT gen_random_uuid()`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS country VARCHAR(128)`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS tax_number VARCHAR(64)`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS industry_type VARCHAR(128)`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS business_type VARCHAR(32)`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS company_size VARCHAR(64)`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS website_url VARCHAR(512)`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255)`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS designation VARCHAR(128)`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS work_email VARCHAR(255)`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS mobile_country_code VARCHAR(8)`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(32)`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS secondary_mobile_country_code VARCHAR(8)`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS secondary_mobile_number VARCHAR(32)`,
    `ALTER TABLE branches ADD COLUMN IF NOT EXISTS country VARCHAR(128)`,
    `ALTER TABLE branches ADD COLUMN IF NOT EXISTS tax_number VARCHAR(64)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS country VARCHAR(128)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS tax_number VARCHAR(64)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS designation VARCHAR(128)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS work_email VARCHAR(255)`,
    `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_type VARCHAR(64)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS city VARCHAR(128)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS timezone VARCHAR(64)`,
    `ALTER TABLE customer_users ADD COLUMN IF NOT EXISTS location_id VARCHAR(128)`,
    `ALTER TABLE setup_business_hour_shifts ADD COLUMN IF NOT EXISTS end_day_of_week VARCHAR(16)`,
    `ALTER TABLE setup_business_hour_shifts ADD COLUMN IF NOT EXISTS break_start_time TIME`,
    `ALTER TABLE setup_business_hour_shifts ADD COLUMN IF NOT EXISTS break_end_time TIME`,
    `ALTER TABLE setup_business_hour_shifts ADD COLUMN IF NOT EXISTS break_start_time_2 TIME`,
    `ALTER TABLE setup_business_hour_shifts ADD COLUMN IF NOT EXISTS break_end_time_2 TIME`,
    `ALTER TABLE setup_business_hours ADD COLUMN IF NOT EXISTS open_time TIME`,
    `ALTER TABLE setup_business_hours ADD COLUMN IF NOT EXISTS close_time TIME`,
    `UPDATE setup_business_hours SET open_time = '09:00' WHERE open_time IS NULL`,
    `UPDATE setup_business_hours SET close_time = '22:00' WHERE close_time IS NULL`,
    `ALTER TABLE setup_business_hours ADD COLUMN IF NOT EXISTS working_days JSONB`,
    `UPDATE setup_business_hours
     SET working_days = '["Monday","Tuesday","Wednesday","Thursday","Friday"]'::jsonb
     WHERE working_days IS NULL`,
    `ALTER TABLE setup_teams ADD COLUMN IF NOT EXISTS member_ids JSONB`,
    `UPDATE setup_teams SET member_ids = '[]'::jsonb WHERE member_ids IS NULL`,
    `ALTER TABLE setup_roles ADD COLUMN IF NOT EXISTS product_id VARCHAR(128)`,
    `ALTER TABLE setup_roles ADD COLUMN IF NOT EXISTS module_permissions JSONB`,
    `UPDATE setup_roles SET module_permissions = '[]'::jsonb WHERE module_permissions IS NULL`,
    `UPDATE setup_roles
     SET product_id = accessible_products->>0
     WHERE product_id IS NULL
       AND jsonb_typeof(accessible_products) = 'array'
       AND jsonb_array_length(accessible_products) = 1`,
    `DELETE FROM setup_roles
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
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_setup_roles_org_product_name
     ON setup_roles (organization_id, product_id, lower(name))`,
    `ALTER TABLE setup_users ADD COLUMN IF NOT EXISTS team_id UUID`,
    `ALTER TABLE setup_users ADD COLUMN IF NOT EXISTS business_hours_id UUID`,
    `ALTER TABLE setup_users ADD COLUMN IF NOT EXISTS shift_types JSONB`,
    `UPDATE setup_users SET shift_types = '[]'::jsonb WHERE shift_types IS NULL`,
    `CREATE TABLE IF NOT EXISTS setup_user_product_access (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES setup_users(id) ON DELETE CASCADE,
      product_id VARCHAR(128) NOT NULL,
      role_id UUID NOT NULL REFERENCES setup_roles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, product_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_setup_user_product_access_org ON setup_user_product_access(organization_id)`,
    `CREATE INDEX IF NOT EXISTS idx_setup_user_product_access_user ON setup_user_product_access(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_setup_user_product_access_role ON setup_user_product_access(role_id)`,
    `DO $$
     BEGIN
       IF EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'setup_users'
           AND column_name = 'product_access'
       ) THEN
         INSERT INTO setup_user_product_access (organization_id, user_id, product_id, role_id)
         SELECT u.organization_id,
                u.id,
                elem->>'productId',
                (elem->>'roleId')::uuid
         FROM setup_users u
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE
             WHEN u.product_access IS NULL THEN '[]'::jsonb
             WHEN jsonb_typeof(u.product_access) = 'array' THEN u.product_access
             ELSE '[]'::jsonb
           END
         ) AS elem
         WHERE COALESCE(elem->>'productId', '') <> ''
           AND COALESCE(elem->>'roleId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND EXISTS (
             SELECT 1
             FROM setup_roles r
             WHERE r.id = (elem->>'roleId')::uuid
               AND r.organization_id = u.organization_id
           )
         ON CONFLICT (user_id, product_id) DO NOTHING;
       END IF;
     END $$`,
    `ALTER TABLE setup_users DROP COLUMN IF EXISTS product_access`,
    `CREATE TABLE IF NOT EXISTS setup_knowledge_documents (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_setup_knowledge_docs_org ON setup_knowledge_documents(organization_id)`,
    `CREATE INDEX IF NOT EXISTS idx_setup_knowledge_docs_category ON setup_knowledge_documents(organization_id, category)`,
    `UPDATE customer_users SET role = 'org_admin' WHERE role IN ('admin', 'member') AND location_id IS NULL`,
    `UPDATE customer_users SET role = 'branch_user' WHERE role = 'member' AND location_id IS NOT NULL`,
    `ALTER TABLE quotations ALTER COLUMN id SET DEFAULT gen_random_uuid()`,
    `ALTER TABLE quotations ALTER COLUMN version SET DEFAULT 1`,
    `ALTER TABLE product_assignments ALTER COLUMN id SET DEFAULT gen_random_uuid()`,
    `ALTER TABLE quote_sessions ALTER COLUMN created_at SET DEFAULT NOW()`,
    `ALTER TABLE quote_sessions ALTER COLUMN updated_at SET DEFAULT NOW()`,
    `CREATE TABLE IF NOT EXISTS mail_folder_cache (
      profile VARCHAR(16) NOT NULL,
      folder VARCHAR(32) NOT NULL,
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (profile, folder)
    )`,
    `CREATE TABLE IF NOT EXISTS mail_oauth_connections (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mail_oauth_connections_profile ON mail_oauth_connections(mailbox_profile)`,
    `CREATE INDEX IF NOT EXISTS idx_mail_oauth_connections_email ON mail_oauth_connections(account_email)`,
    `CREATE TABLE IF NOT EXISTS mail_oauth_states (
      state VARCHAR(128) PRIMARY KEY,
      account_type VARCHAR(16) NOT NULL DEFAULT 'internal',
      account_id UUID NOT NULL,
      mailbox_profile VARCHAR(16) NOT NULL,
      return_path VARCHAR(512) NOT NULL DEFAULT '/mail',
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mail_oauth_states_expires_at ON mail_oauth_states(expires_at)`,
    `CREATE TABLE IF NOT EXISTS email_outbox (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status)`,
    `CREATE TABLE IF NOT EXISTS graph_mail_subscriptions (
      subscription_id VARCHAR(128) PRIMARY KEY,
      mailbox_profile VARCHAR(16) NOT NULL,
      resource TEXT NOT NULL,
      client_state VARCHAR(128),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_payment_id VARCHAR(255)`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_customer_id VARCHAR(255)`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS last_provider_event_id VARCHAR(255)`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_reason TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_provider_payment_id ON payments(provider_payment_id)`,
    `CREATE TABLE IF NOT EXISTS payment_webhook_events (
      provider VARCHAR(32) NOT NULL,
      event_id VARCHAR(255) NOT NULL,
      event_type VARCHAR(128),
      quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
      payload JSONB,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (provider, event_id)
    )`,
    `ALTER TABLE active_products ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ`,
    `UPDATE payments SET status = 'pending' WHERE status IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_provider_payment_id ON payments(provider_payment_id)`,
    `ALTER TABLE product_assignments DROP CONSTRAINT IF EXISTS product_assignments_lead_id_branch_id_fkey`,
    `ALTER TABLE product_assignments DROP CONSTRAINT IF EXISTS product_assignments_lead_id_billing_target_id_fkey`,
    `ALTER TABLE active_products DROP CONSTRAINT IF EXISTS active_products_lead_id_branch_id_fkey`,
    `ALTER TABLE active_products DROP CONSTRAINT IF EXISTS active_products_lead_id_billing_target_id_fkey`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ`,
    `CREATE INDEX IF NOT EXISTS idx_leads_assigned_user_id ON leads(assigned_user_id)`,
    `CREATE TABLE IF NOT EXISTS lead_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      assigned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead_id ON lead_assignments(lead_id)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS converted_organization_id UUID`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ`,
    `CREATE INDEX IF NOT EXISTS idx_leads_converted_organization_id ON leads(converted_organization_id)`,
    `CREATE TABLE IF NOT EXISTS subscription_invoices (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_subscription_invoices_subscription_id ON subscription_invoices(subscription_id)`,
    `CREATE INDEX IF NOT EXISTS idx_subscription_invoices_status_generation_date ON subscription_invoices(status, generation_date)`,
    `CREATE TABLE IF NOT EXISTS support_tickets (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_support_tickets_organization_id ON support_tickets(organization_id)`,
    `CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status)`,
    `CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS support_ticket_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      author_type VARCHAR(32) NOT NULL,
      author_label VARCHAR(255),
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_id ON support_ticket_messages(ticket_id)`,
    `CREATE TABLE IF NOT EXISTS customer_product_requests (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_customer_product_requests_organization_id ON customer_product_requests(organization_id)`,
    `CREATE INDEX IF NOT EXISTS idx_customer_product_requests_status ON customer_product_requests(status)`,
    `CREATE INDEX IF NOT EXISTS idx_customer_product_requests_created_at ON customer_product_requests(created_at DESC)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active'`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS inactivated_at TIMESTAMPTZ`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS inactivated_by VARCHAR(255)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS inactivation_reason TEXT`,
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`,
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(255)`,
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`,
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_effective_at TIMESTAMPTZ`,
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS scheduled_cancellation_request_id UUID`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS scheduled_drop_at TIMESTAMPTZ`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS scheduled_drop_request_id UUID`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS scheduled_drop_by VARCHAR(255)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS scheduled_drop_reason TEXT`,
    `ALTER TABLE branch_cancellation_requests ADD COLUMN IF NOT EXISTS effective_timing VARCHAR(32) NOT NULL DEFAULT 'end_of_period'`,
    `ALTER TABLE branch_cancellation_requests ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ`,
    `CREATE INDEX IF NOT EXISTS idx_subscriptions_cancel_effective_at ON subscriptions(cancel_effective_at) WHERE cancel_at_period_end = TRUE`,
    `CREATE TABLE IF NOT EXISTS branch_cancellation_requests (
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
      resolved_at TIMESTAMPTZ,
      resolved_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_branch_cancellation_requests_status ON branch_cancellation_requests(status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_branch_cancellation_requests_organization_id ON branch_cancellation_requests(organization_id, location_id)`,
    `CREATE INDEX IF NOT EXISTS idx_branch_cancellation_requests_subscription_id ON branch_cancellation_requests(subscription_id)`,
    `CREATE TABLE IF NOT EXISTS branch_cancellation_alerts (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_branch_cancellation_alerts_request_id ON branch_cancellation_alerts(request_id)`,
    `CREATE TABLE IF NOT EXISTS setup_channel_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      channel_type VARCHAR(32) NOT NULL,
      name VARCHAR(255) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_setup_channel_configs_org ON setup_channel_configs(organization_id)`,
    `CREATE INDEX IF NOT EXISTS idx_setup_channel_configs_type ON setup_channel_configs(organization_id, channel_type)`,
    `CREATE TABLE IF NOT EXISTS setup_email_configs (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_setup_email_configs_channel ON setup_email_configs(channel_config_id)`,
    `CREATE TABLE IF NOT EXISTS setup_webchat_configs (
      channel_config_id UUID PRIMARY KEY REFERENCES setup_channel_configs(id) ON DELETE CASCADE,
      webchat_id VARCHAR(64) NOT NULL UNIQUE,
      title VARCHAR(255) NOT NULL,
      alias_title VARCHAR(255) NOT NULL,
      description TEXT,
      greeting_message TEXT NOT NULL,
      trigger_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_setup_webchat_configs_webchat_id ON setup_webchat_configs(webchat_id)`,
    `ALTER TABLE setup_webchat_configs ADD COLUMN IF NOT EXISTS personalisation JSONB NOT NULL DEFAULT '{}'::jsonb`,
    `ALTER TABLE setup_users ADD COLUMN IF NOT EXISTS password_hash TEXT`,
    `ALTER TABLE setup_users ADD COLUMN IF NOT EXISTS invite_status VARCHAR(32)`,
    `ALTER TABLE setup_users ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ`,
    `ALTER TABLE setup_users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ`,
    `UPDATE setup_users SET invite_status = 'pending' WHERE invite_status IS NULL`,
    `CREATE TABLE IF NOT EXISTS setup_user_invite_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES setup_users(id) ON DELETE CASCADE,
      token_hash VARCHAR(128) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_setup_user_invite_tokens_user ON setup_user_invite_tokens(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_setup_user_invite_tokens_expires ON setup_user_invite_tokens(expires_at)`,
    `CREATE TABLE IF NOT EXISTS setup_ccaas_queues (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      team_id UUID NOT NULL REFERENCES setup_teams(id) ON DELETE CASCADE,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_setup_ccaas_queues_org ON setup_ccaas_queues(organization_id)`,
    `CREATE TABLE IF NOT EXISTS setup_ccaas_queue_agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      queue_id UUID NOT NULL REFERENCES setup_ccaas_queues(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES setup_users(id) ON DELETE CASCADE,
      handles_calls BOOLEAN NOT NULL DEFAULT FALSE,
      handles_email BOOLEAN NOT NULL DEFAULT FALSE,
      handles_social BOOLEAN NOT NULL DEFAULT FALSE,
      handles_chat BOOLEAN NOT NULL DEFAULT FALSE,
      chat_concurrency INTEGER NOT NULL DEFAULT 1,
      email_concurrency INTEGER NOT NULL DEFAULT 1,
      social_concurrency INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (queue_id, user_id)
    )`,
    // One agent may belong to only one queue (CCaaS rule).
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_setup_ccaas_queue_agents_user_unique
     ON setup_ccaas_queue_agents(user_id)`,
    `ALTER TABLE setup_ccaas_queue_agents ADD COLUMN IF NOT EXISTS handles_whatsapp BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE setup_ccaas_queue_agents ADD COLUMN IF NOT EXISTS handles_instagram BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE setup_ccaas_queue_agents ADD COLUMN IF NOT EXISTS handles_facebook BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE setup_ccaas_queue_agents ADD COLUMN IF NOT EXISTS whatsapp_concurrency INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE setup_ccaas_queue_agents ADD COLUMN IF NOT EXISTS instagram_concurrency INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE setup_ccaas_queue_agents ADD COLUMN IF NOT EXISTS facebook_concurrency INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE setup_ccaas_queue_agents ADD COLUMN IF NOT EXISTS call_type VARCHAR(16) NOT NULL DEFAULT 'both'`,
    `ALTER TABLE setup_email_configs ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(32)`,
    `ALTER TABLE setup_email_configs ADD COLUMN IF NOT EXISTS ccaas_handler VARCHAR(32)`,
    `UPDATE setup_ccaas_queue_agents
     SET handles_whatsapp = TRUE,
         whatsapp_concurrency = GREATEST(social_concurrency, 1)
     WHERE handles_social = TRUE
       AND handles_whatsapp = FALSE
       AND handles_instagram = FALSE
       AND handles_facebook = FALSE`,
    `CREATE TABLE IF NOT EXISTS setup_crm_channel_agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_config_id UUID NOT NULL REFERENCES setup_channel_configs(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES setup_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (channel_config_id, user_id)
    )`,
  ];

  for (const sql of repairs) {
    try {
      await query(sql);
    } catch {
      // Table/column may not exist yet on partial schemas.
    }
  }
}

async function seedUsers() {
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM users");
  if (rows[0].count > 0) {
    return;
  }

  const seeds = [
    {
      email: env("ADMIN_LOGIN_EMAIL"),
      password: env("ADMIN_LOGIN_PASSWORD"),
      role: "admin",
      displayName: "Admin",
      department: "Admin",
    },
    {
      email: env("SALES_LOGIN_EMAIL"),
      password: env("SALES_LOGIN_PASSWORD"),
      role: "sales",
      displayName: "Sales User",
      department: "Sales",
    },
    {
      email: env("FINANCE_LOGIN_EMAIL") || env("FINANCE_TEAM_EMAIL"),
      password: env("FINANCE_LOGIN_PASSWORD"),
      role: "finance",
      displayName: "Finance User",
      department: "Finance",
    },
    {
      email: env("SALES_ADMIN_LOGIN_EMAIL"),
      password: env("SALES_ADMIN_LOGIN_PASSWORD"),
      role: "sales_admin",
      displayName: "Sales Admin",
      department: "Sales Management",
    },
  ];

  for (const seed of seeds) {
    if (!seed.email || !seed.password) {
      continue;
    }

    const hashedPassword = await hashPassword(seed.password);

    await query(
      `INSERT INTO users (
        id, email, password, role, display_name, department, is_active,
        created_at, updated_at, created_by, updated_by
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, TRUE, NOW(), NOW(), 'system', 'system'
      )
      ON CONFLICT (email) DO NOTHING`,
      [seed.email.toLowerCase(), hashedPassword, seed.role, seed.displayName, seed.department],
    );
  }
}

async function ensureSalesAdminUser() {
  const email = env("SALES_ADMIN_LOGIN_EMAIL");
  const password = env("SALES_ADMIN_LOGIN_PASSWORD");
  if (!email || !password) {
    return;
  }

  const normalizedEmail = email.toLowerCase();

  const { rows } = await query(`SELECT id, role FROM users WHERE email = $1 LIMIT 1`, [
    normalizedEmail,
  ]);

  if (rows[0] && rows[0].role !== "sales_admin") {
    console.warn(
      `[db] SALES_ADMIN_LOGIN_EMAIL (${normalizedEmail}) is already used by role "${rows[0].role}" — skipped sales admin seed.`,
    );
    return;
  }

  const hashedPassword = await hashPassword(password);

  await query(
    `INSERT INTO users (
      id, email, password, role, display_name, department, is_active,
      created_at, updated_at, created_by, updated_by
    ) VALUES (
      gen_random_uuid(), $1, $2, 'sales_admin', 'Sales Admin', 'Sales Management', TRUE, NOW(), NOW(), 'system', 'system'
    )
    ON CONFLICT (email) DO UPDATE SET
      role = 'sales_admin',
      password = EXCLUDED.password,
      display_name = EXCLUDED.display_name,
      department = EXCLUDED.department,
      is_active = TRUE,
      updated_at = NOW(),
      updated_by = 'system'`,
    [normalizedEmail, hashedPassword],
  );
}

async function seedPricingCatalog() {
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM pricing_catalogs");
  if (rows[0].count > 0) {
    return;
  }

  const catalog = DEFAULT_PRICING_CATALOG;
  await query(
    `INSERT INTO pricing_catalogs (version, updated_at, updated_by, regions, shared, products, region_pricing)
     VALUES ($1, NOW(), 'system', $2, $3, $4, $5)`,
    [
      catalog.version,
      JSON.stringify(catalog.regions),
      JSON.stringify(catalog.shared),
      JSON.stringify(catalog.products),
      JSON.stringify(catalog.regionPricing || null),
    ],
  );
}

function readLegacyJson(fileName, fallback) {
  const filePath = path.join(legacyDataDir, fileName);
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function importLegacyUsers() {
  const users = readLegacyJson("users.json", []);
  for (const user of users) {
    await query(
      `INSERT INTO users (id, email, password, role, display_name, phone, department, is_active, created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, NOW()), $10, COALESCE($11::timestamptz, NOW()), $12)
       ON CONFLICT (email) DO NOTHING`,
      [
        user.id,
        user.email,
        user.password,
        user.role,
        user.displayName || "",
        user.phone || "",
        user.department || "",
        user.isActive !== false,
        user.createdAt,
        user.createdBy || "legacy",
        user.updatedAt,
        user.updatedBy || "legacy",
      ],
    );
  }
}

async function importLegacyQuotations() {
  const quotations = readLegacyJson("quotations.json", []);
  if (!Array.isArray(quotations) || quotations.length === 0) {
    return;
  }

  const { rows } = await query("SELECT COUNT(*)::int AS count FROM quotations");
  if (rows[0].count > 0) {
    return;
  }

  for (const entry of quotations) {
    if (!entry.leadId) {
      continue;
    }

    const leadSnapshot = entry.lead || {};
    await query(
      `INSERT INTO leads (id, domain_id, company_name, contact_name, work_email, billing_address, status, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [
        entry.leadId,
        leadSnapshot.domainId || String(Math.floor(1000 + Math.random() * 9000)),
        leadSnapshot.companyName || "Imported customer",
        leadSnapshot.contactName || "",
        leadSnapshot.workEmail || "",
        leadSnapshot.billingAddress || "",
        entry.status === "Approved" ? "Approved" : "Pending Finance Review",
      ],
    );

    if (leadSnapshot.billingAddress?.trim()) {
      await query(
        `INSERT INTO branches (id, lead_id, label, address, is_primary)
         VALUES ('hq', $1, 'Head office', $2, TRUE)
         ON CONFLICT (lead_id, id) DO NOTHING`,
        [entry.leadId, leadSnapshot.billingAddress.trim()],
      );
    }

    for (const assignment of entry.assignments || []) {
      const branchId = assignment.branchId || "hq";
      const billingTargetId = assignment.billingTargetId || branchId;

      for (const branchKey of new Set([branchId, billingTargetId])) {
        await query(
          `INSERT INTO branches (id, lead_id, label, address, is_primary)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (lead_id, id) DO NOTHING`,
          [
            branchKey,
            entry.leadId,
            branchKey === "hq" ? "Head office" : branchKey,
            leadSnapshot.billingAddress || "",
            branchKey === "hq",
          ],
        );
      }
    }

    await query(
      `INSERT INTO quotations (
        id, lead_id, lead_snapshot, file_name, pdf_base64, invoice_mode, branch_summary,
        subtotal, grand_total, currency, gst_rate, status, finance_note,
        submitted_by, submitted_at, reviewed_by, reviewed_at, version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,1)
      ON CONFLICT (id) DO NOTHING`,
      [
        entry.id,
        entry.leadId,
        JSON.stringify(entry.lead || null),
        entry.fileName || null,
        entry.pdfBase64 || null,
        entry.invoiceMode || null,
        JSON.stringify(entry.branchSummary || null),
        entry.subtotal ?? null,
        entry.grandTotal ?? null,
        entry.currency || "INR",
        entry.gstRate ?? null,
        entry.status,
        entry.financeNote || "",
        entry.submittedBy || "",
        entry.submittedAt || new Date().toISOString(),
        entry.reviewedBy || null,
        entry.reviewedAt || null,
      ],
    );

    for (const assignment of entry.assignments || []) {
      await query(
        `INSERT INTO product_assignments (id, quotation_id, lead_id, product_id, branch_id, billing_target_id, change_type, config)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [
          ensureUuid(assignment.id, () => crypto.randomUUID()),
          entry.id,
          entry.leadId,
          assignment.productId,
          assignment.branchId || "hq",
          assignment.billingTargetId || assignment.branchId || "hq",
          assignment.changeType || "new",
          JSON.stringify(assignment.config || null),
        ],
      );
    }

    if (entry.payment) {
      await query(
        `INSERT INTO payments (quotation_id, provider, payment_link_url, payment_link_id, subtotal, grand_total, currency, gst_rate, amount_label, dry_run, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (quotation_id) DO NOTHING`,
        [
          entry.id,
          entry.payment.provider || null,
          entry.payment.paymentLinkUrl || null,
          entry.payment.paymentLinkId || null,
          entry.payment.subtotal ?? null,
          entry.payment.grandTotal ?? null,
          entry.payment.currency || null,
          entry.payment.gstRate ?? null,
          entry.payment.amountLabel || null,
          entry.payment.dryRun === true,
          entry.payment.updatedAt || new Date().toISOString(),
        ],
      );
    }
  }
}

async function importLegacyPricing() {
  const override = readLegacyJson("pricing-catalog.json", null);
  if (!override) {
    return;
  }

  await query(
    `INSERT INTO pricing_catalogs (version, updated_at, updated_by, regions, shared, products, region_pricing)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (version) DO UPDATE SET
       updated_at = EXCLUDED.updated_at,
       updated_by = EXCLUDED.updated_by,
       regions = EXCLUDED.regions,
       shared = EXCLUDED.shared,
       products = EXCLUDED.products,
       region_pricing = EXCLUDED.region_pricing`,
    [
      override.version || 1,
      override.updatedAt || new Date().toISOString(),
      override.updatedBy || "legacy",
      JSON.stringify(override.regions || null),
      JSON.stringify(override.shared || null),
      JSON.stringify(override.products || null),
      JSON.stringify(override.regionPricing || null),
    ],
  );
}

async function backfillLeadAssignments() {
  await query(
    `UPDATE leads l
     SET assigned_user_id = u.id,
         assigned_at = COALESCE(l.assigned_at, q.submitted_at, l.updated_at)
     FROM (
       SELECT DISTINCT ON (q.lead_id)
         q.lead_id,
         q.submitted_by,
         q.submitted_at
       FROM quotations q
       WHERE q.submitted_by IS NOT NULL AND q.submitted_by <> ''
       ORDER BY q.lead_id, q.submitted_at DESC NULLS LAST
     ) q
     JOIN users u ON LOWER(u.email) = LOWER(q.submitted_by) AND u.role = 'sales'
     WHERE l.id = q.lead_id
       AND l.assigned_user_id IS NULL`,
  );
}

async function backfillCustomerHub() {
  const { withTransaction } = await import("./pool.js");
  const { convertLeadToOrganization } = await import("../organizations.js");
  const { syncSubscriptionsFromQuotation } = await import("../subscriptions.js");

  const { rows: paidLeads } = await query(
    `SELECT DISTINCT l.id AS lead_id, q.id AS quotation_id, p.paid_at
     FROM leads l
     JOIN quotations q ON q.lead_id = l.id AND q.status = 'Paid'
     JOIN payments p ON p.quotation_id = q.id AND p.status = 'paid'
     WHERE l.converted_organization_id IS NULL
     ORDER BY p.paid_at ASC NULLS LAST`,
  );

  for (const row of paidLeads) {
    try {
      await withTransaction(async (client) => {
        await convertLeadToOrganization(row.lead_id, client);
        await syncSubscriptionsFromQuotation(row.quotation_id, client, {
          paidAt: row.paid_at,
        });
      });
    } catch (error) {
      console.warn(
        `[db] customer hub backfill skipped for lead ${row.lead_id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  const { rows: convertedWithoutSubs } = await query(
    `SELECT o.source_lead_id, q.id AS quotation_id, p.paid_at
     FROM organizations o
     JOIN quotations q ON q.lead_id = o.source_lead_id AND q.status = 'Paid'
     JOIN payments p ON p.quotation_id = q.id AND p.status = 'paid'
     WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.organization_id = o.id)
     ORDER BY p.paid_at DESC`,
  );

  for (const row of convertedWithoutSubs) {
    try {
      await withTransaction(async (client) => {
        await syncSubscriptionsFromQuotation(row.quotation_id, client, {
          paidAt: row.paid_at,
        });
      });
    } catch (error) {
      console.warn(
        `[db] subscription backfill skipped for lead ${row.source_lead_id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

async function backfillBranchCountries() {
  await query(
    `UPDATE additional_addresses aa
     SET country = l.country
     FROM leads l
     WHERE aa.lead_id = l.id
       AND (aa.country IS NULL OR aa.country = '')
       AND l.country IS NOT NULL
       AND l.country <> ''`,
  );

  await query(
    `UPDATE branches b
     SET country = l.country
     FROM leads l
     WHERE b.lead_id = l.id
       AND b.is_primary = TRUE
       AND (b.country IS NULL OR b.country = '')
       AND l.country IS NOT NULL
       AND l.country <> ''`,
  );

  await query(
    `UPDATE branches b
     SET country = aa.country
     FROM additional_addresses aa
     WHERE b.lead_id = aa.lead_id
       AND b.id = aa.id::text
       AND (b.country IS NULL OR b.country = '')
       AND aa.country IS NOT NULL
       AND aa.country <> ''`,
  );

  await query(
    `UPDATE organization_locations ol
     SET country = o.country
     FROM organizations o
     WHERE ol.organization_id = o.id
       AND (ol.country IS NULL OR ol.country = '')
       AND o.country IS NOT NULL
       AND o.country <> ''`,
  );
}

async function backfillOrganizationBusinessTypes() {
  await query(
    `UPDATE organizations o
     SET business_type = l.business_type,
         updated_at = NOW()
     FROM leads l
     WHERE o.source_lead_id = l.id
       AND (o.business_type IS NULL OR o.business_type = '')
       AND l.business_type IS NOT NULL
       AND l.business_type <> ''`,
  );
}

/** Ensure each setup user appears on at most one team (prefer setup_users.team_id). */
async function reconcileOneTeamPerUser() {
  const { rows: teams } = await query(
    `SELECT id, organization_id, name, member_ids, created_at
     FROM setup_teams
     ORDER BY created_at ASC, name ASC`,
  );
  if (!teams.length) return;

  const { rows: users } = await query(
    `SELECT id, organization_id, team_id FROM setup_users`,
  );
  const usersById = new Map(users.map((user) => [user.id, user]));

  /** @type {Map<string, string[]>} */
  const teamIdsByUser = new Map();
  for (const team of teams) {
    const memberIds = Array.isArray(team.member_ids) ? team.member_ids : [];
    for (const userId of memberIds) {
      const list = teamIdsByUser.get(userId) || [];
      list.push(team.id);
      teamIdsByUser.set(userId, list);
    }
  }

  /** @type {Map<string, Set<string>>} */
  const keepMembersByTeam = new Map(teams.map((team) => [team.id, new Set()]));

  for (const [userId, teamIds] of teamIdsByUser) {
    const user = usersById.get(userId);
    let keepTeamId = null;
    if (user?.team_id && teamIds.includes(user.team_id)) {
      keepTeamId = user.team_id;
    } else {
      keepTeamId = teamIds[0] || null;
    }
    if (!keepTeamId) continue;
    keepMembersByTeam.get(keepTeamId)?.add(userId);
    if (user && user.team_id !== keepTeamId) {
      await query(`UPDATE setup_users SET team_id = $2, updated_at = NOW() WHERE id = $1`, [
        userId,
        keepTeamId,
      ]);
    }
  }

  // Users with team_id but missing from that team's member_ids
  for (const user of users) {
    if (!user.team_id) continue;
    keepMembersByTeam.get(user.team_id)?.add(user.id);
  }

  for (const team of teams) {
    const nextMembers = [...(keepMembersByTeam.get(team.id) || [])];
    const prevMembers = Array.isArray(team.member_ids) ? team.member_ids.map(String) : [];
    const same =
      prevMembers.length === nextMembers.length &&
      prevMembers.every((id) => nextMembers.includes(id));
    if (same) continue;
    await query(
      `UPDATE setup_teams SET member_ids = $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [team.id, JSON.stringify(nextMembers)],
    );
  }
}

export async function migrateDatabase() {
  await waitForDatabaseReady();
  await runSchema();
  await runRoutines();
  await repairSchema();
  await backfillBranchCountries();
  await backfillOrganizationBusinessTypes();
  try {
    await reconcileOneTeamPerUser();
  } catch (error) {
    console.warn(
      "[db] One-team-per-user reconcile skipped:",
      error instanceof Error ? error.message : error,
    );
  }
  await repairActiveProductKeys();
  await backfillLeadAssignments();
  try {
    await backfillCustomerHub();
  } catch (error) {
    console.warn(
      "[db] Customer hub backfill skipped:",
      error instanceof Error ? error.message : error,
    );
  }
  await seedUsers();
  await ensureSalesAdminUser();
  await seedPricingCatalog();

  try {
    await importLegacyUsers();
    await importLegacyQuotations();
    await importLegacyPricing();
  } catch (error) {
    console.warn(
      "[db] Legacy JSON import skipped:",
      error instanceof Error ? error.message : error,
    );
  }

  console.log("[db] Schema ready and seed data applied.");
}
