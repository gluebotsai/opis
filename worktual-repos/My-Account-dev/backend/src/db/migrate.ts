import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { backendRoot } from "../config/runtime-paths.js";
import { DEFAULT_PRICING_CATALOG } from "../lib/pricingCatalogDefaults.js";
import { hashPassword } from "../modules/users/user-store.js";
import { isDatabaseConnectivityError, pool, query } from "./pool.js";
import { ensureUuid, env } from "./util.js";

async function repairActiveProductKeys() {
  const { rows: keyColumns } = await query(
    `SELECT character_maximum_length
     FROM information_schema.columns
     WHERE table_schema IN ('accounts', 'public')
       AND table_name = 'active_products'
       AND column_name = 'key'
     ORDER BY CASE WHEN table_schema = 'accounts' THEN 0 ELSE 1 END
     LIMIT 1`,
  );
  if (Number(keyColumns[0]?.character_maximum_length || 0) < 160) {
    await query(`ALTER TABLE active_products ALTER COLUMN key TYPE VARCHAR(160)`);
  }

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

  const { ensureActiveProductsForQuotation } = await import("../modules/quotations/quotation-store.js");

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

const projectRoot = backendRoot;
const schemaFile = path.join(projectRoot, "database", "schema.sql");
const legacyDataDir = path.join(projectRoot, "data");

async function waitForDatabaseReady({ timeoutMs = 120_000, intervalMs = 1_000 }: any = {}) {
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
      if (!isDatabaseConnectivityError(error)) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[db] Database not ready yet (${message}) — waiting...`);
    }

    await new Promise((resolve: any) => setTimeout(resolve, intervalMs));
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

  // Parameter/result renames require DROP before CREATE OR REPLACE.
  await query(`
    DROP FUNCTION IF EXISTS fn_create_support_ticket_with_message(
      text, uuid, uuid, uuid, text, text, text, text, text, text, text,
      boolean, boolean, text, text, text, text
    );
  `);
  await query(`
    DROP FUNCTION IF EXISTS fn_sales_oversight_stale_leads(text, text, integer, integer);
  `);

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
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS state VARCHAR(128)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_size VARCHAR(64)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_decision_maker BOOLEAN NOT NULL DEFAULT TRUE`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS decision_maker_name VARCHAR(255)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_type VARCHAR(32)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS industry_type VARCHAR(128)`,
    `ALTER TABLE additional_addresses ALTER COLUMN id SET DEFAULT gen_random_uuid()`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS country VARCHAR(128)`,
    `ALTER TABLE additional_addresses ADD COLUMN IF NOT EXISTS state VARCHAR(128)`,
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
    `ALTER TABLE branches ADD COLUMN IF NOT EXISTS state VARCHAR(128)`,
    `ALTER TABLE branches ADD COLUMN IF NOT EXISTS tax_number VARCHAR(64)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS country VARCHAR(128)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS tax_number VARCHAR(64)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS designation VARCHAR(128)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS work_email VARCHAR(255)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS industry_type VARCHAR(128)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS mobile_country_code VARCHAR(8)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(32)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS secondary_mobile_country_code VARCHAR(8)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS secondary_mobile_number VARCHAR(32)`,
    `ALTER TABLE customer_users ADD COLUMN IF NOT EXISTS branch_id VARCHAR(128)`,
    `ALTER TABLE customer_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`,
    `UPDATE customer_users
     SET role = 'branch_user',
         branch_id = COALESCE(NULLIF(TRIM(branch_id), ''), 'hq'),
         updated_at = NOW()
     WHERE role IN ('admin', 'member') AND (branch_id IS NULL OR TRIM(branch_id) = '')`,
    `UPDATE customer_users SET role = 'branch_user' WHERE role = 'member' AND branch_id IS NOT NULL`,
    `UPDATE customer_users cu
     SET role = 'branch_user',
         branch_id = COALESCE(
           NULLIF(TRIM(cu.branch_id), ''),
           (
             SELECT ol.id::text
             FROM organization_locations ol
             WHERE ol.organization_id = cu.organization_id
               AND ol.is_primary = true
             ORDER BY ol.id ASC
             LIMIT 1
           ),
           'hq'
         ),
         updated_at = NOW()
     WHERE cu.role = 'org_admin'
        OR cu.branch_id IS NULL
        OR TRIM(cu.branch_id) = ''`,
    `ALTER TABLE quotations ALTER COLUMN id SET DEFAULT gen_random_uuid()`,
    `ALTER TABLE quotations ALTER COLUMN version SET DEFAULT 1`,
    `ALTER TABLE quotations ADD COLUMN IF NOT EXISTS submission_batch_id UUID`,
    `UPDATE quotations SET submission_batch_id = id WHERE submission_batch_id IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_quotations_submission_batch ON quotations(submission_batch_id)`,
    `ALTER TABLE quotations ADD COLUMN IF NOT EXISTS source_product_request_id UUID`,
    `CREATE INDEX IF NOT EXISTS idx_quotations_source_product_request
       ON quotations(source_product_request_id)
       WHERE source_product_request_id IS NOT NULL`,
    `ALTER TABLE product_assignments ALTER COLUMN id SET DEFAULT gen_random_uuid()`,
    `ALTER TABLE quote_sessions ALTER COLUMN created_at SET DEFAULT NOW()`,
    `ALTER TABLE quote_sessions ALTER COLUMN updated_at SET DEFAULT NOW()`,
    `CREATE TABLE IF NOT EXISTS mail_folder_cache (
      profile VARCHAR(64) NOT NULL,
      folder VARCHAR(32) NOT NULL,
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (profile, folder)
    )`,
    `CREATE TABLE IF NOT EXISTS mail_oauth_connections (
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (account_type, account_id, mailbox_profile)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mail_oauth_connections_profile ON mail_oauth_connections(mailbox_profile)`,
    `CREATE INDEX IF NOT EXISTS idx_mail_oauth_connections_email ON mail_oauth_connections(account_email)`,
    `ALTER TABLE mail_oauth_connections ADD COLUMN IF NOT EXISTS needs_reauth BOOLEAN NOT NULL DEFAULT FALSE`,
    `CREATE TABLE IF NOT EXISTS mail_oauth_states (
      state VARCHAR(128) PRIMARY KEY,
      account_type VARCHAR(16) NOT NULL DEFAULT 'internal',
      account_id UUID NOT NULL,
      mailbox_profile VARCHAR(64) NOT NULL,
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
      mailbox_profile VARCHAR(64) NOT NULL,
      resource TEXT NOT NULL,
      client_state VARCHAR(128),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS mail_signatures (
      account_type VARCHAR(16) NOT NULL DEFAULT 'internal',
      account_id UUID NOT NULL,
      mailbox_profile VARCHAR(64) NOT NULL,
      html_body TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (account_type, account_id, mailbox_profile)
    )`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_payment_id VARCHAR(255)`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_customer_id VARCHAR(255)`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS last_provider_event_id VARCHAR(255)`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_reason TEXT`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_reported_at TIMESTAMPTZ`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_reported_by VARCHAR(255)`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS finance_confirmed_at TIMESTAMPTZ`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS finance_confirmed_by VARCHAR(255)`,
    `UPDATE payments SET finance_confirmed_at = paid_at WHERE status = 'paid' AND finance_confirmed_at IS NULL AND paid_at IS NOT NULL`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS welcome_email_status VARCHAR(32)`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS welcome_email_last_error TEXT`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS welcome_email_attempts INTEGER NOT NULL DEFAULT 0`,
    `UPDATE payments SET welcome_email_status = 'unknown' WHERE status = 'paid' AND welcome_email_status IS NULL`,
    `UPDATE payments SET welcome_email_status = 'unknown' WHERE status = 'paid' AND welcome_email_status = 'sent' AND welcome_email_sent_at IS NULL`,
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
    `ALTER TABLE product_assignments DROP CONSTRAINT IF EXISTS product_assignments_lead_id_billing_branch_id_fkey`,
    `ALTER TABLE active_products DROP CONSTRAINT IF EXISTS active_products_lead_id_branch_id_fkey`,
    `ALTER TABLE active_products DROP CONSTRAINT IF EXISTS active_products_lead_id_billing_branch_id_fkey`,
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
      tenant_id VARCHAR(16),
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
      tenant_id VARCHAR(16),
      company_name VARCHAR(255),
      contact_email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_customer_product_requests_organization_id ON customer_product_requests(organization_id)`,
    `CREATE INDEX IF NOT EXISTS idx_customer_product_requests_status ON customer_product_requests(status)`,
    `CREATE INDEX IF NOT EXISTS idx_customer_product_requests_created_at ON customer_product_requests(created_at DESC)`,
    `ALTER TABLE customer_product_requests ADD COLUMN IF NOT EXISTS new_branches JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `DO $$ BEGIN
       ALTER TABLE quotations
         ADD CONSTRAINT quotations_source_product_request_id_fkey
         FOREIGN KEY (source_product_request_id)
         REFERENCES customer_product_requests(id)
         ON DELETE SET NULL;
     EXCEPTION
       WHEN duplicate_object THEN NULL;
       WHEN undefined_column THEN NULL;
     END $$`,
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
      resolved_at TIMESTAMPTZ,
      resolved_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_branch_cancellation_requests_status ON branch_cancellation_requests(status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_branch_cancellation_requests_organization_id ON branch_cancellation_requests(organization_id, branch_id)`,
    `CREATE INDEX IF NOT EXISTS idx_branch_cancellation_requests_subscription_id ON branch_cancellation_requests(subscription_id)`,
    `CREATE TABLE IF NOT EXISTS branch_cancellation_alerts (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_branch_cancellation_alerts_request_id ON branch_cancellation_alerts(request_id)`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS finance_alert_status VARCHAR(32)`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS finance_alert_sent_at TIMESTAMPTZ`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS finance_alert_last_error TEXT`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS finance_alert_attempts INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS internal_credentials_status VARCHAR(32)`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS internal_credentials_sent_at TIMESTAMPTZ`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS internal_credentials_last_error TEXT`,
    `CREATE TABLE IF NOT EXISTS resellers (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_resellers_is_active ON resellers(is_active)`,
    `CREATE TABLE IF NOT EXISTS reseller_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reseller_id UUID NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name VARCHAR(255),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_reseller_users_reseller_id ON reseller_users(reseller_id)`,
    `CREATE TABLE IF NOT EXISTS reseller_auth_sessions (
      token VARCHAR(128) PRIMARY KEY,
      reseller_user_id UUID NOT NULL REFERENCES reseller_users(id) ON DELETE CASCADE,
      reseller_id UUID NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_reseller_auth_sessions_expires_at ON reseller_auth_sessions(expires_at)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS reseller_id UUID REFERENCES resellers(id) ON DELETE SET NULL`,
    `CREATE INDEX IF NOT EXISTS idx_leads_reseller_id ON leads(reseller_id)`,
    `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS reseller_id UUID REFERENCES resellers(id) ON DELETE SET NULL`,
    `CREATE INDEX IF NOT EXISTS idx_organizations_reseller_id ON organizations(reseller_id)`,
    `CREATE TABLE IF NOT EXISTS partners (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_partners_is_active ON partners(is_active)`,
    `CREATE TABLE IF NOT EXISTS partner_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name VARCHAR(255),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_partner_users_partner_id ON partner_users(partner_id)`,
    `CREATE TABLE IF NOT EXISTS partner_auth_sessions (
      token VARCHAR(128) PRIMARY KEY,
      partner_user_id UUID NOT NULL REFERENCES partner_users(id) ON DELETE CASCADE,
      partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_partner_auth_sessions_expires_at ON partner_auth_sessions(expires_at)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id) ON DELETE SET NULL`,
    `CREATE INDEX IF NOT EXISTS idx_leads_partner_id ON leads(partner_id)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_kind VARCHAR(32) NOT NULL DEFAULT 'standard'`,
    `CREATE INDEX IF NOT EXISTS idx_leads_lead_kind ON leads(lead_kind)`,
    `CREATE TABLE IF NOT EXISTS commission_slabs (
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
    )`,
    `ALTER TABLE commission_slabs ADD COLUMN IF NOT EXISTS country VARCHAR(128) NOT NULL DEFAULT 'India'`,
    `CREATE INDEX IF NOT EXISTS idx_commission_slabs_active ON commission_slabs(is_active, sort_order)`,
    `CREATE INDEX IF NOT EXISTS idx_commission_slabs_country ON commission_slabs(country, is_active, sort_order)`,
    `CREATE TABLE IF NOT EXISTS partner_bank_accounts (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_partner_bank_accounts_partner_id ON partner_bank_accounts(partner_id)`,
    `CREATE TABLE IF NOT EXISTS partner_commission_entries (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_partner_commission_entries_partner_id ON partner_commission_entries(partner_id)`,
    `CREATE INDEX IF NOT EXISTS idx_partner_commission_entries_status ON partner_commission_entries(status)`,
    `CREATE TABLE IF NOT EXISTS quotation_branch_payments (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_quotation_branch_payments_quotation_id ON quotation_branch_payments(quotation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_quotation_branch_payments_payment_link_id ON quotation_branch_payments(payment_link_id)`,
    `CREATE TABLE IF NOT EXISTS password_reset_otps (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_password_reset_otps_email ON password_reset_otps(email)`,
    `CREATE INDEX IF NOT EXISTS idx_password_reset_otps_expires_at ON password_reset_otps(expires_at)`,
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
  const { rows } = await query<{ count: number }>("SELECT COUNT(*)::int AS count FROM users");
  if ((rows[0]?.count ?? 0) > 0) {
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
    {
      email: env("NUMBER_MANAGEMENT_LOGIN_EMAIL"),
      password: env("NUMBER_MANAGEMENT_LOGIN_PASSWORD"),
      role: "number_management",
      displayName: "Number Management",
      department: "Number Management",
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

async function ensureNumberManagementUser() {
  const email = env("NUMBER_MANAGEMENT_LOGIN_EMAIL");
  const password = env("NUMBER_MANAGEMENT_LOGIN_PASSWORD");
  if (!email || !password) {
    return;
  }

  const normalizedEmail = email.toLowerCase();

  const { rows } = await query(`SELECT id, role FROM users WHERE email = $1 LIMIT 1`, [
    normalizedEmail,
  ]);

  if (rows[0] && rows[0].role !== "number_management") {
    console.warn(
      `[db] NUMBER_MANAGEMENT_LOGIN_EMAIL (${normalizedEmail}) is already used by role "${rows[0].role}" — skipped number management seed.`,
    );
    return;
  }

  const hashedPassword = await hashPassword(password);

  await query(
    `INSERT INTO users (
      id, email, password, role, display_name, department, is_active,
      created_at, updated_at, created_by, updated_by
    ) VALUES (
      gen_random_uuid(), $1, $2, 'number_management', 'Number Management', 'Number Management', TRUE, NOW(), NOW(), 'system', 'system'
    )
    ON CONFLICT (email) DO UPDATE SET
      role = 'number_management',
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
  const { rows } = await query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM pricing_catalogs",
  );
  if ((rows[0]?.count ?? 0) > 0) {
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

function readLegacyJson(fileName: any, fallback: any) {
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

  const { rows } = await query<{ count: number }>("SELECT COUNT(*)::int AS count FROM quotations");
  if ((rows[0]?.count ?? 0) > 0) {
    return;
  }

  for (const entry of quotations) {
    if (!entry.leadId) {
      continue;
    }

    const leadSnapshot = entry.lead || {};
    await query(
      `INSERT INTO leads (id, tenant_id, company_name, contact_name, work_email, billing_address, status, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [
        entry.leadId,
        leadSnapshot.tenantId || String(Math.floor(1000 + Math.random() * 9000)),
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
      const billingBranchId = assignment.billingBranchId || branchId;

      for (const branchKey of new Set([branchId, billingBranchId])) {
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
        `INSERT INTO product_assignments (id, quotation_id, lead_id, product_id, branch_id, billing_branch_id, change_type, config)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [
          ensureUuid(assignment.id, () => crypto.randomUUID()),
          entry.id,
          entry.leadId,
          assignment.productId,
          assignment.branchId || "hq",
          assignment.billingBranchId || assignment.branchId || "hq",
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
  const { convertLeadToOrganization } = await import("../modules/organizations/organization-store.js");
  const { syncSubscriptionsFromQuotation } = await import("../modules/subscriptions/subscription-store.js");

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
      await withTransaction(async (client: any) => {
        await convertLeadToOrganization(row.lead_id, client);
        await syncSubscriptionsFromQuotation(row.quotation_id, client, {
          paidAt: row.paid_at as any,
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
      await withTransaction(async (client: any) => {
        await syncSubscriptionsFromQuotation(row.quotation_id, client, {
          paidAt: row.paid_at as any,
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

async function backfillOrganizationLocationContacts() {
  for (const sql of [
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS industry_type VARCHAR(128)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS mobile_country_code VARCHAR(8)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(32)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS secondary_mobile_country_code VARCHAR(8)`,
    `ALTER TABLE organization_locations ADD COLUMN IF NOT EXISTS secondary_mobile_number VARCHAR(32)`,
  ]) {
    await query(sql);
  }

  await query(
    `UPDATE organizations o
     SET industry_type = COALESCE(NULLIF(o.industry_type, ''), l.industry_type),
         mobile_country_code = COALESCE(NULLIF(o.mobile_country_code, ''), l.mobile_country_code),
         mobile_number = COALESCE(NULLIF(o.mobile_number, ''), l.mobile_number)
     FROM leads l
     WHERE o.source_lead_id = l.id
       AND (
         (COALESCE(o.industry_type, '') = '' AND COALESCE(l.industry_type, '') <> '')
         OR (COALESCE(o.mobile_number, '') = '' AND COALESCE(l.mobile_number, '') <> '')
       )`,
  );

  await query(
    `UPDATE organization_locations ol
     SET industry_type = COALESCE(NULLIF(ol.industry_type, ''), l.industry_type),
         mobile_country_code = COALESCE(NULLIF(ol.mobile_country_code, ''), l.mobile_country_code),
         mobile_number = COALESCE(NULLIF(ol.mobile_number, ''), l.mobile_number),
         secondary_mobile_country_code = COALESCE(
           NULLIF(ol.secondary_mobile_country_code, ''),
           l.secondary_mobile_country_code
         ),
         secondary_mobile_number = COALESCE(
           NULLIF(ol.secondary_mobile_number, ''),
           l.secondary_mobile_number
         )
     FROM organizations o
     JOIN leads l ON l.id = o.source_lead_id
     WHERE ol.organization_id = o.id
       AND ol.is_primary = TRUE
       AND (
         (COALESCE(ol.industry_type, '') = '' AND COALESCE(l.industry_type, '') <> '')
         OR (COALESCE(ol.mobile_number, '') = '' AND COALESCE(l.mobile_number, '') <> '')
       )`,
  );

  await query(
    `UPDATE organization_locations ol
     SET industry_type = COALESCE(NULLIF(ol.industry_type, ''), aa.industry_type),
         mobile_country_code = COALESCE(NULLIF(ol.mobile_country_code, ''), aa.mobile_country_code),
         mobile_number = COALESCE(NULLIF(ol.mobile_number, ''), aa.mobile_number),
         secondary_mobile_country_code = COALESCE(
           NULLIF(ol.secondary_mobile_country_code, ''),
           aa.secondary_mobile_country_code
         ),
         secondary_mobile_number = COALESCE(
           NULLIF(ol.secondary_mobile_number, ''),
           aa.secondary_mobile_number
         )
     FROM organizations o
     JOIN additional_addresses aa
       ON aa.lead_id = o.source_lead_id
     WHERE ol.organization_id = o.id
       AND ol.is_primary = FALSE
       AND aa.id::text = ol.id
       AND (
         (COALESCE(ol.industry_type, '') = '' AND COALESCE(aa.industry_type, '') <> '')
         OR (COALESCE(ol.mobile_number, '') = '' AND COALESCE(aa.mobile_number, '') <> '')
       )`,
  );
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

async function renameColumnIfNeeded(tableName: any, oldColumn: any, newColumn: any) {
  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = '${tableName}'
          AND column_name = '${oldColumn}'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = '${tableName}'
          AND column_name = '${newColumn}'
      ) THEN
        EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', '${tableName}', '${oldColumn}', '${newColumn}');
      END IF;
    END $$;
  `);
}

async function renameIndexIfNeeded(oldIndex: any, newIndex: any) {
  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'i'
          AND n.nspname = 'public'
          AND c.relname = '${oldIndex}'
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'i'
          AND n.nspname = 'public'
          AND c.relname = '${newIndex}'
      ) THEN
        EXECUTE format('ALTER INDEX %I RENAME TO %I', '${oldIndex}', '${newIndex}');
      END IF;
    END $$;
  `);
}

async function renameMeaningfulColumns() {
  // domain_id → tenant_id
  for (const table of [
    "leads",
    "organizations",
    "support_tickets",
    "customer_product_requests",
    "branch_cancellation_requests",
  ]) {
    await renameColumnIfNeeded(table, "domain_id", "tenant_id");
  }
  await renameIndexIfNeeded("idx_organizations_domain_id", "idx_organizations_tenant_id");

  // location_id → branch_id (branch-scoped FKs only)
  for (const table of [
    "subscriptions",
    "subscription_items",
    "customer_users",
    "branch_cancellation_requests",
    "branch_cancellation_alerts",
  ]) {
    await renameColumnIfNeeded(table, "location_id", "branch_id");
  }
  await renameIndexIfNeeded(
    "idx_branch_cancellation_requests_organization_id",
    "idx_branch_cancellation_requests_org_branch",
  );

  // billing_target_id → billing_branch_id
  for (const table of [
    "product_assignments",
    "active_products",
    "subscriptions",
    "quotation_invoices",
    "quotation_branch_payments",
  ]) {
    await renameColumnIfNeeded(table, "billing_target_id", "billing_branch_id");
  }

  // Rebuild unique constraints that embed old column names when needed.
  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'quotation_branch_payments_quotation_id_billing_target_id_key'
      ) THEN
        ALTER TABLE quotation_branch_payments
          DROP CONSTRAINT quotation_branch_payments_quotation_id_billing_target_id_key;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'quotation_branch_payments'
          AND column_name = 'billing_branch_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'quotation_branch_payments_quotation_id_billing_branch_id_key'
      ) THEN
        ALTER TABLE quotation_branch_payments
          ADD CONSTRAINT quotation_branch_payments_quotation_id_billing_branch_id_key
          UNIQUE (quotation_id, billing_branch_id);
      END IF;
    END $$;
  `);

  await query(`
    DO $$
    DECLARE
      old_conname text;
    BEGIN
      SELECT c.conname INTO old_conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'branch_cancellation_alerts'
        AND c.contype = 'u'
        AND pg_get_constraintdef(c.oid) ILIKE '%location_id%';
      IF old_conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE branch_cancellation_alerts DROP CONSTRAINT %I', old_conname);
      END IF;
    END $$;
  `);
}

async function hasAccountsSchemaInstalled() {
  const { rows } = await pool.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'accounts' AND table_name = 'leads'
     LIMIT 1`,
  );
  return rows.length > 0;
}

async function runSqlFile(relativePath: any) {
  const fullPath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`[db] SQL file missing, skip: ${relativePath}`);
    return;
  }
  const sql = fs.readFileSync(fullPath, "utf8");
  await pool.query(sql);
  console.log(`[db] applied ${relativePath}`);
}

const MULTI_SCHEMA_V2_FILES = [
  "database/v2/01_move_tables.sql",
  "database/v2/02_tenancy.sql",
  "database/v2/03_product_stubs.sql",
  "database/v2/04_rls.sql",
  "database/v2/05_grants.sql",
];

async function backfillAutoRenewalQuotations() {
  const { withTransaction } = await import("./pool.js");
  const {
    resolveRenewalServicePeriod,
    withRenewalQuotationDocuments,
    renewalChangeTypeFields,
  } = await import("../modules/renewals/invoice-pdf.js");
  const { getProductName } = await import("../lib/productCatalog.js");

  const { rows } = await query(
    `SELECT q.id, q.submitted_at, q.pdf_base64, q.lead_snapshot, q.file_name,
            q.subtotal, q.grand_total, q.currency, q.gst_rate, q.invoice_mode
     FROM quotations q
     WHERE q.submitted_by = 'Auto renewal'
     ORDER BY q.submitted_at ASC NULLS LAST`,
  );

  let repaired = 0;
  for (const row of rows) {
    try {
      await withTransaction(async (client: any) => {
        const { rows: assignmentRows } = await client.query(
          `SELECT id, product_id, branch_id, billing_branch_id, change_type, config
           FROM product_assignments
           WHERE quotation_id = $1`,
          [row.id],
        );
        if (!assignmentRows.length) {
          return;
        }

        const purchaseDate = (row.submitted_at as Date | undefined) || new Date();
        const period = resolveRenewalServicePeriod(purchaseDate);
        const { changeType, changeTypeLabel } = renewalChangeTypeFields();
        const lead =
          typeof row.lead_snapshot === "string"
            ? JSON.parse(row.lead_snapshot)
            : row.lead_snapshot;

        const assignments: any[] = [];
        for (const assignment of assignmentRows) {
          const config =
            typeof assignment.config === "string"
              ? JSON.parse(assignment.config || "{}")
              : assignment.config || {};
          const nextConfig = {
            ...config,
            isRenewalQuote: true,
            changeType,
            periodStart: config.periodStart || period.periodStartIso,
            periodEnd: config.periodEnd || period.periodEndIso,
            periodLabel: config.periodLabel || period.periodLabel,
            billingCycle: config.billingCycle === "yearly" ? "yearly" : "monthly",
          };
          await client.query(
            `UPDATE product_assignments
             SET change_type = $2, config = $3::jsonb
             WHERE id = $1`,
            [assignment.id, changeType, JSON.stringify(nextConfig)],
          );
          assignments.push({
            productId: assignment.product_id,
            branchId: assignment.branch_id || "hq",
            billingBranchId: assignment.billing_branch_id || assignment.branch_id || "hq",
            changeType,
            config: nextConfig,
          });
        }

        await client.query(
          `UPDATE product_summary_items
           SET change_type_label = $2
           WHERE quotation_id = $1`,
          [row.id, changeTypeLabel],
        );

        const needsPdf = !row.pdf_base64;
        if (needsPdf && lead) {
          const productSummary = assignments.map((assignment: any) => ({
            productId: assignment.productId,
            name: getProductName(assignment.productId),
            changeType,
            changeTypeLabel,
            periodStart: assignment.config.periodStart,
            periodEnd: assignment.config.periodEnd,
            periodLabel: assignment.config.periodLabel,
          }));
          const payload = {
            leadId: lead.id || null,
            lead,
            assignments,
            productSummary,
            invoiceMode: row.invoice_mode || "consolidated",
            subtotal: row.subtotal !== null ? Number(row.subtotal) : null,
            grandTotal: row.grand_total !== null ? Number(row.grand_total) : null,
            currency: row.currency || "INR",
            gstRate: row.gst_rate !== null ? Number(row.gst_rate) : 0.18,
            payment: {
              subtotal: row.subtotal !== null ? Number(row.subtotal) : null,
              grandTotal: row.grand_total !== null ? Number(row.grand_total) : null,
              currency: row.currency || "INR",
              gstRate: row.gst_rate !== null ? Number(row.gst_rate) : 0.18,
            },
            fileName: row.file_name || `renewal-${row.id}.pdf`,
            pdfBase64: null,
            invoices: [],
            submittedBy: "Auto renewal",
          };
          const withDocs = await withRenewalQuotationDocuments(payload);
          if (withDocs.pdfBase64) {
            await client.query(
              `UPDATE quotations
               SET pdf_base64 = $2,
                   file_name = COALESCE(NULLIF(file_name, ''), $3),
                   subtotal = COALESCE($4, subtotal),
                   grand_total = COALESCE($5, grand_total),
                   updated_at = NOW()
               WHERE id = $1`,
              [
                row.id,
                withDocs.pdfBase64,
                withDocs.fileName,
                withDocs.subtotal ?? null,
                withDocs.grandTotal ?? null,
              ],
            );

            const { rows: existingInvoices } = await client.query(
              `SELECT id FROM quotation_invoices WHERE quotation_id = $1 LIMIT 1`,
              [row.id],
            );
            const invoice = withDocs.invoices?.[0];
            if (invoice?.pdfBase64) {
              if (existingInvoices.length) {
                await client.query(
                  `UPDATE quotation_invoices
                   SET file_name = $2, pdf_base64 = $3, subtotal = $4, grand_total = $5
                   WHERE id = $1`,
                  [
                    existingInvoices[0].id,
                    invoice.fileName,
                    invoice.pdfBase64,
                    invoice.subtotal ?? null,
                    invoice.grandTotal ?? null,
                  ],
                );
              } else {
                await client.query(
                  `INSERT INTO quotation_invoices
                     (quotation_id, file_name, pdf_base64, billing_branch_id, branch_label, subtotal, grand_total)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                  [
                    row.id,
                    invoice.fileName,
                    invoice.pdfBase64,
                    invoice.billingBranchId || null,
                    invoice.branchLabel || null,
                    invoice.subtotal ?? null,
                    invoice.grandTotal ?? null,
                  ],
                );
              }
            }
          }
        }
      });
      repaired += 1;
    } catch (error) {
      console.warn(
        `[db] auto renewal backfill skipped for quotation ${row.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (repaired > 0) {
    console.log(`[db] repaired ${repaired} auto-renewal quotation(s)`);
  }
}

async function ensureProductRequestNewBranchesColumn() {
  await query(
    `ALTER TABLE customer_product_requests
     ADD COLUMN IF NOT EXISTS new_branches JSONB NOT NULL DEFAULT '[]'::jsonb`,
  );
}

async function ensureCustomerUsersMustChangePasswordColumn() {
  // Existing accounts-schema installs skip repairSchema(); this tracked op still runs.
  await query(
    `ALTER TABLE customer_users
     ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`,
  );
}

async function ensureInvoicePurchaseCutoffDayColumn() {
  await query(
    `ALTER TABLE invoice_company_settings
     ADD COLUMN IF NOT EXISTS purchase_cutoff_day INT NOT NULL DEFAULT 20`,
  );
  await query(
    `UPDATE invoice_company_settings
     SET purchase_cutoff_day = 20
     WHERE purchase_cutoff_day IS NULL
        OR purchase_cutoff_day < 1
        OR purchase_cutoff_day > 28`,
  );
}

/** CCaaS agent / included DID / queue capacity / total number entitlement columns. */
async function ensureSubscriptionNumberCountColumns() {
  await query(
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS agent_count INTEGER NOT NULL DEFAULT 0`,
  );
  await query(
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS included_number_count INTEGER NOT NULL DEFAULT 0`,
  );
  await query(
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS queue_capacity_count INTEGER NOT NULL DEFAULT 0`,
  );
  await query(
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS total_number_count INTEGER NOT NULL DEFAULT 0`,
  );
  await query(
    `ALTER TABLE product_assignments ADD COLUMN IF NOT EXISTS agent_count INTEGER`,
  );
  await query(
    `ALTER TABLE product_assignments ADD COLUMN IF NOT EXISTS included_number_count INTEGER`,
  );
  await query(
    `ALTER TABLE product_assignments ADD COLUMN IF NOT EXISTS queue_capacity_count INTEGER`,
  );
  await query(
    `ALTER TABLE product_assignments ADD COLUMN IF NOT EXISTS total_number_count INTEGER`,
  );
}

async function ensureInvoiceCompanySettingsSchema() {
  await query(`
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
    )
  `);
  await query(
    `ALTER TABLE invoice_company_settings
     ADD COLUMN IF NOT EXISTS purchase_cutoff_day INT NOT NULL DEFAULT 20`,
  );
  await query(
    `INSERT INTO invoice_company_settings (id, invoice_prefix, series_year, next_sequence)
     VALUES ('default', 'WIPL', EXTRACT(YEAR FROM NOW())::INT, 1)
     ON CONFLICT (id) DO NOTHING`,
  );
  await query(
    `ALTER TABLE quotations
     ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(64)`,
  );
}

async function ensurePartnerBankCountryFields() {
  await query(
    `ALTER TABLE partner_bank_accounts
     ADD COLUMN IF NOT EXISTS iban VARCHAR(64)`,
  );
  await query(
    `ALTER TABLE partner_bank_accounts
     ADD COLUMN IF NOT EXISTS swift_bic VARCHAR(32)`,
  );
  await query(
    `ALTER TABLE partner_bank_accounts
     ALTER COLUMN bank_name SET DEFAULT ''`,
  );
  await query(
    `ALTER TABLE partner_bank_accounts
     ALTER COLUMN account_number SET DEFAULT ''`,
  );
  await query(
    `ALTER TABLE partner_bank_accounts
     ALTER COLUMN ifsc_or_routing SET DEFAULT ''`,
  );
}

async function ensurePhasedGoLiveBillingSchema() {
  await query(
    `ALTER TABLE quotations
     ADD COLUMN IF NOT EXISTS billing_phase VARCHAR(32) NOT NULL DEFAULT 'standard'`,
  );

  await query(`
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
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_product_go_live_lead_id ON product_go_live(lead_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_product_go_live_org_id ON product_go_live(organization_id)`);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_product_go_live_status ON product_go_live(lifecycle_status)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_product_go_live_uat_expires ON product_go_live(uat_expires_at)`,
  );

  await query(`
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
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_usage_metrics_monthly_org ON usage_metrics_monthly(organization_id)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_usage_metrics_monthly_ym ON usage_metrics_monthly(year_month)`,
  );
}

async function ensureNumberManagementSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS number_mappings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(128) NOT NULL,
      organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
      lead_id UUID,
      product_id VARCHAR(64) NOT NULL DEFAULT 'contact-center',
      number VARCHAR(64) NOT NULL,
      number_type VARCHAR(32) NOT NULL DEFAULT 'other',
      agent_label VARCHAR(255) NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      notes TEXT NOT NULL DEFAULT '',
      mapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by VARCHAR(255),
      updated_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `ALTER TABLE number_mappings ADD COLUMN IF NOT EXISTS product_id VARCHAR(64) NOT NULL DEFAULT 'contact-center'`,
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_number_mappings_tenant ON number_mappings(tenant_id)`);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_number_mappings_org ON number_mappings(organization_id)`,
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_number_mappings_number ON number_mappings(number)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_number_mappings_status ON number_mappings(status)`);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_number_mappings_product ON number_mappings(product_id)`,
  );
  // One phone/DID/agent number string → one product mapping globally.
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_number_mappings_number_lower
    ON number_mappings (LOWER(TRIM(number)))
  `);

  // Inventory of numbers not yet mapped to a tenant.
  await query(`
    CREATE TABLE IF NOT EXISTS available_numbers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      number VARCHAR(64) NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_by VARCHAR(255),
      updated_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_available_numbers_number_lower
    ON available_numbers (LOWER(TRIM(number)))
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS agent_did_usage_monthly (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(128) NOT NULL,
      organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
      number_mapping_id UUID REFERENCES number_mappings(id) ON DELETE SET NULL,
      number VARCHAR(64) NOT NULL,
      year_month CHAR(7) NOT NULL,
      usage_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
      usage_unit VARCHAR(32) NOT NULL DEFAULT 'units',
      notes TEXT NOT NULL DEFAULT '',
      entered_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, year_month, number)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_agent_did_usage_tenant_ym ON agent_did_usage_monthly(tenant_id, year_month)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_agent_did_usage_org ON agent_did_usage_monthly(organization_id)`,
  );

  await query(`
    CREATE TABLE IF NOT EXISTS mail_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      subject VARCHAR(998) NOT NULL DEFAULT '',
      body_html TEXT NOT NULL DEFAULT '',
      created_by VARCHAR(255),
      updated_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_mail_templates_name ON mail_templates(LOWER(name))`,
  );
}

/** Upgrade path when number_management_v1 ran before product_id existed. */
async function ensureNumberMappingsProductIdColumn() {
  await query(
    `ALTER TABLE number_mappings
     ADD COLUMN IF NOT EXISTS product_id VARCHAR(64) NOT NULL DEFAULT 'contact-center'`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_number_mappings_product ON number_mappings(product_id)`,
  );
}

/**
 * Number Inventory: providers + per-provider unassigned numbers.
 * Separate from number_management_v1 so existing installs that already applied
 * that key still get these tables (CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 */
async function ensureNumberProvidersInventorySchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS number_providers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      image_data TEXT NOT NULL DEFAULT '',
      country VARCHAR(128) NOT NULL DEFAULT '',
      storage VARCHAR(255) NOT NULL DEFAULT '',
      account_id VARCHAR(255) NOT NULL DEFAULT '',
      created_by VARCHAR(255),
      updated_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_number_providers_name_lower
    ON number_providers (LOWER(name))
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS provider_numbers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_id UUID NOT NULL REFERENCES number_providers(id) ON DELETE CASCADE,
      number VARCHAR(64) NOT NULL,
      created_by VARCHAR(255),
      updated_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_numbers_number_lower
    ON provider_numbers (LOWER(TRIM(number)))
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_provider_numbers_provider
    ON provider_numbers (provider_id)
  `);

  await query(`
    ALTER TABLE number_mappings
    ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES number_providers(id) ON DELETE SET NULL
  `);
}

/**
 * mailbox_profile / folder cache profile were VARCHAR(16); role
 * `number_management` is 18 chars and overflows on insert.
 */
async function ensureMailMailboxProfileWiden() {
  const statements = [
    `ALTER TABLE mail_folder_cache ALTER COLUMN profile TYPE VARCHAR(64)`,
    `ALTER TABLE mail_oauth_connections ALTER COLUMN mailbox_profile TYPE VARCHAR(64)`,
    `ALTER TABLE mail_oauth_states ALTER COLUMN mailbox_profile TYPE VARCHAR(64)`,
    `ALTER TABLE graph_mail_subscriptions ALTER COLUMN mailbox_profile TYPE VARCHAR(64)`,
    `ALTER TABLE mail_signatures ALTER COLUMN mailbox_profile TYPE VARCHAR(64)`,
  ];
  for (const sql of statements) {
    try {
      await query(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/does not exist/i.test(message)) {
        continue;
      }
      throw error;
    }
  }
}

async function ensureBranchAddRequestsSchema() {
  await query(`
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
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_branch_add_requests_organization
     ON branch_add_requests(organization_id, created_at DESC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_branch_add_requests_lead
     ON branch_add_requests(source_lead_id, created_at DESC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_branch_add_requests_status
     ON branch_add_requests(status, created_at DESC)`,
  );
  try {
    await query(`SELECT platform.ensure_tenant_rls('accounts', 'branch_add_requests')`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/platform\.ensure_tenant_rls|does not exist/i.test(message)) {
      throw error;
    }
  }
}

async function migrateOrgAdminCustomerUsersToBranch() {
  const { rowCount } = await query(
    `UPDATE customer_users cu
     SET role = 'branch_user',
         branch_id = COALESCE(
           NULLIF(TRIM(cu.branch_id), ''),
           (
             SELECT ol.id::text
             FROM organization_locations ol
             WHERE ol.organization_id = cu.organization_id
               AND ol.is_primary = true
             ORDER BY ol.id ASC
             LIMIT 1
           ),
           'hq'
         ),
         updated_at = NOW()
     WHERE cu.role = 'org_admin'
        OR cu.branch_id IS NULL
        OR TRIM(cu.branch_id) = ''`,
  );

  await query(
    `DELETE FROM product_access_grants pag
     USING customer_users cu, subscriptions s
     WHERE pag.customer_user_id = cu.id
       AND s.id = pag.subscription_id
       AND cu.branch_id IS NOT NULL
       AND s.branch_id IS DISTINCT FROM cu.branch_id`,
  );

  if ((rowCount ?? 0) > 0) {
    console.log(`[db] converted ${rowCount} legacy org_admin / null-branch portal user(s)`);
  }
}

const MAINTENANCE_MIGRATIONS = {
  RENAME_COLUMNS: "maintenance/rename_meaningful_columns_v1",
  BRANCH_COUNTRIES: "maintenance/backfill_branch_countries_v1",
  ORG_LOCATION_CONTACTS: "maintenance/backfill_org_location_contacts_v1",
  ACTIVE_PRODUCT_KEYS: "maintenance/repair_active_product_keys_v2",
  LEAD_ASSIGNMENTS: "maintenance/backfill_lead_assignments_v1",
  CUSTOMER_HUB: "maintenance/backfill_customer_hub_v1",
  AUTO_RENEWAL_QUOTES: "maintenance/backfill_auto_renewal_quotations_v1",
  PRODUCT_REQUEST_NEW_BRANCHES: "maintenance/product_request_new_branches_v1",
  PHASED_GO_LIVE_BILLING: "maintenance/phased_go_live_billing_v1",
  BRANCH_ONLY_PORTAL_USERS: "maintenance/branch_only_portal_users_v1",
  NUMBER_MANAGEMENT: "maintenance/number_management_v1",
  NUMBER_MAPPINGS_PRODUCT_ID: "maintenance/number_mappings_product_id_v1",
  MAIL_MAILBOX_PROFILE_WIDEN: "maintenance/mail_mailbox_profile_widen_v1",
  BRANCH_ADD_REQUESTS: "maintenance/branch_add_requests_v1",
  PARTNER_BANK_COUNTRY_FIELDS: "maintenance/partner_bank_country_fields_v1",
  INVOICE_COMPANY_SETTINGS: "maintenance/invoice_company_settings_v1",
  CUSTOMER_USERS_MUST_CHANGE_PASSWORD: "maintenance/customer_users_must_change_password_v1",
  INVOICE_PURCHASE_CUTOFF_DAY: "maintenance/invoice_purchase_cutoff_day_v1",
  SUBSCRIPTION_NUMBER_COUNTS: "maintenance/subscription_number_counts_v1",
  NUMBER_PROVIDERS_INVENTORY: "maintenance/number_providers_inventory_v1",
  LEGACY_USERS: "legacy/import_users_v1",
  LEGACY_QUOTATIONS: "legacy/import_quotations_v1",
  LEGACY_PRICING: "legacy/import_pricing_v1",
};

const EXISTING_MAINTENANCE_BASELINE_KEY = "maintenance/existing_install_baseline_v1";
const HISTORICAL_MAINTENANCE_KEYS = [
  MAINTENANCE_MIGRATIONS.RENAME_COLUMNS,
  MAINTENANCE_MIGRATIONS.BRANCH_COUNTRIES,
  MAINTENANCE_MIGRATIONS.ACTIVE_PRODUCT_KEYS,
  MAINTENANCE_MIGRATIONS.LEAD_ASSIGNMENTS,
  MAINTENANCE_MIGRATIONS.CUSTOMER_HUB,
  MAINTENANCE_MIGRATIONS.LEGACY_USERS,
  MAINTENANCE_MIGRATIONS.LEGACY_QUOTATIONS,
  MAINTENANCE_MIGRATIONS.LEGACY_PRICING,
];

async function ensureMigrationLedger() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform.schema_migrations (
      migration_key VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function baselineExistingMaintenance() {
  if (await isMigrationApplied(EXISTING_MAINTENANCE_BASELINE_KEY)) {
    return;
  }

  const migrationKeys = [
    ...HISTORICAL_MAINTENANCE_KEYS,
    EXISTING_MAINTENANCE_BASELINE_KEY,
  ];
  await pool.query(
    `INSERT INTO platform.schema_migrations (migration_key)
     SELECT unnest($1::text[])
     ON CONFLICT (migration_key) DO NOTHING`,
    [migrationKeys],
  );
  console.log("[db] baselined historical repairs/backfills (existing installation)");
}

async function isMigrationApplied(migrationKey: any) {
  const { rows } = await pool.query(
    `SELECT 1 FROM platform.schema_migrations WHERE migration_key = $1`,
    [migrationKey],
  );
  return rows.length > 0;
}

async function recordMigrationApplied(migrationKey: any) {
  await pool.query(
    `INSERT INTO platform.schema_migrations (migration_key)
     VALUES ($1)
     ON CONFLICT (migration_key) DO NOTHING`,
    [migrationKey],
  );
}

async function runTrackedOperation(migrationKey: any, label: any, operation: any) {
  if (await isMigrationApplied(migrationKey)) {
    console.log(`[db] migration already applied, skip: ${label}`);
    return { skipped: true };
  }

  console.log(`[db] migration start: ${label}`);
  await operation();
  await recordMigrationApplied(migrationKey);
  console.log(`[db] migration complete: ${label}`);
  return { skipped: false };
}

function routinesMigrationKey() {
  const routinesFile = path.join(projectRoot, "database", "routines.sql");
  if (!fs.existsSync(routinesFile)) {
    return null;
  }
  const digest = crypto
    .createHash("sha256")
    .update(fs.readFileSync(routinesFile))
    .digest("hex");
  return `database/routines.sql:${digest}`;
}

async function runTrackedRoutines({ baselineExisting = false }: any = {}) {
  const migrationKey = routinesMigrationKey();
  if (!migrationKey) {
    return;
  }

  if (await isMigrationApplied(migrationKey)) {
    console.log("[db] routines unchanged, skip: database/routines.sql");
    return;
  }

  if (baselineExisting) {
    const { rows } = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM pg_proc WHERE proname = 'fn_sales_oversight_stale_leads'
       ) AS routines_present`,
    );
    if (rows[0]?.routines_present) {
      await recordMigrationApplied(migrationKey);
      console.log("[db] baselined existing database/routines.sql (already installed)");
      return;
    }
  }

  await runTrackedOperation(migrationKey, "database/routines.sql", runRoutines);
}

async function isMultiSchemaV2Complete() {
  const { rows } = await pool.query(`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'accounts'
          AND table_name = 'leads'
          AND column_name = 'organization_id'
      ) AS tenancy_ready,
      to_regclass('crm.accounts') IS NOT NULL AS product_stubs_ready,
      to_regprocedure('platform.set_staff_mode()') IS NOT NULL AS helpers_ready,
      COALESCE((
        SELECT c.relrowsecurity AND c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'accounts' AND c.relname = 'leads'
      ), FALSE) AS rls_ready
  `);
  const state = rows[0] || {};
  return Boolean(
    state.tenancy_ready &&
      state.product_stubs_ready &&
      state.helpers_ready &&
      state.rls_ready,
  );
}

async function baselineCompletedMultiSchemaV2() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM platform.schema_migrations
     WHERE migration_key = ANY($1::text[])`,
    [MULTI_SCHEMA_V2_FILES],
  );
  if ((rows[0]?.count || 0) > 0 || !(await isMultiSchemaV2Complete())) {
    return;
  }

  await pool.query(
    `INSERT INTO platform.schema_migrations (migration_key)
     SELECT unnest($1::text[])
     ON CONFLICT (migration_key) DO NOTHING`,
    [MULTI_SCHEMA_V2_FILES],
  );
  console.log("[db] baselined existing multi-schema v2 migrations (already installed)");
}

async function runTrackedSqlFile(relativePath: any) {
  const { rows } = await pool.query(
    `SELECT 1 FROM platform.schema_migrations WHERE migration_key = $1`,
    [relativePath],
  );
  if (rows.length > 0) {
    console.log(`[db] migration already applied, skip: ${relativePath}`);
    return;
  }

  const fullPath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`[db] SQL file missing, skip: ${relativePath}`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(fs.readFileSync(fullPath, "utf8"));
    await client.query(
      `INSERT INTO platform.schema_migrations (migration_key)
       VALUES ($1)
       ON CONFLICT (migration_key) DO NOTHING`,
      [relativePath],
    );
    await client.query("COMMIT");
    console.log(`[db] applied ${relativePath}`);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
}

async function runMultiSchemaV2() {
  await ensureMigrationLedger();
  await baselineCompletedMultiSchemaV2();
  for (const relativePath of MULTI_SCHEMA_V2_FILES) {
    await runTrackedSqlFile(relativePath);
  }
  await pool.query(`SET search_path TO accounts, platform, public`);
  try {
    await pool.query(`SELECT platform.set_staff_mode()`);
  } catch {
    // ignore until helpers exist
  }
}

async function migrateDatabaseUnlocked() {
  await waitForDatabaseReady();
  await runSqlFile("database/v2/00_schemas.sql");
  await ensureMigrationLedger();

  const alreadySplit = await hasAccountsSchemaInstalled();
  if (alreadySplit) {
    await baselineExistingMaintenance();
  }

  // Rename existing columns before schema.sql indexes that reference the new names.
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.RENAME_COLUMNS,
    "rename meaningful legacy columns",
    renameMeaningfulColumns,
  );

  if (!alreadySplit) {
    await runSchema();
    await runTrackedRoutines();
    await repairSchema();
  } else {
    console.log("[db] accounts schema present — skipping public schema bootstrap");
    await runTrackedRoutines({ baselineExisting: true });
  }

  await runMultiSchemaV2();
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.BRANCH_COUNTRIES,
    "backfill branch countries",
    backfillBranchCountries,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.ORG_LOCATION_CONTACTS,
    "backfill organization location contacts",
    backfillOrganizationLocationContacts,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.ACTIVE_PRODUCT_KEYS,
    "repair active product keys",
    repairActiveProductKeys,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.LEAD_ASSIGNMENTS,
    "backfill lead assignments",
    backfillLeadAssignments,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.CUSTOMER_HUB,
    "backfill customer hub",
    backfillCustomerHub,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.AUTO_RENEWAL_QUOTES,
    "backfill auto renewal quotations",
    backfillAutoRenewalQuotations,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.PRODUCT_REQUEST_NEW_BRANCHES,
    "add product request new_branches column",
    ensureProductRequestNewBranchesColumn,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.PHASED_GO_LIVE_BILLING,
    "add phased go-live billing schema",
    ensurePhasedGoLiveBillingSchema,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.BRANCH_ONLY_PORTAL_USERS,
    "convert org_admin portal users to branch_user",
    migrateOrgAdminCustomerUsersToBranch,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.NUMBER_MANAGEMENT,
    "add number management schema",
    ensureNumberManagementSchema,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.NUMBER_MAPPINGS_PRODUCT_ID,
    "add number_mappings.product_id column",
    ensureNumberMappingsProductIdColumn,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.MAIL_MAILBOX_PROFILE_WIDEN,
    "widen mail mailbox_profile columns for number_management",
    ensureMailMailboxProfileWiden,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.BRANCH_ADD_REQUESTS,
    "add branch add requests schema",
    ensureBranchAddRequestsSchema,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.PARTNER_BANK_COUNTRY_FIELDS,
    "add partner bank country fields",
    ensurePartnerBankCountryFields,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.INVOICE_COMPANY_SETTINGS,
    "add invoice company settings schema",
    ensureInvoiceCompanySettingsSchema,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.CUSTOMER_USERS_MUST_CHANGE_PASSWORD,
    "add customer_users.must_change_password column",
    ensureCustomerUsersMustChangePasswordColumn,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.INVOICE_PURCHASE_CUTOFF_DAY,
    "add invoice_company_settings.purchase_cutoff_day",
    ensureInvoicePurchaseCutoffDayColumn,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.SUBSCRIPTION_NUMBER_COUNTS,
    "add subscription/assignment number count columns",
    ensureSubscriptionNumberCountColumns,
  );
  await runTrackedOperation(
    MAINTENANCE_MIGRATIONS.NUMBER_PROVIDERS_INVENTORY,
    "add number providers inventory schema",
    ensureNumberProvidersInventorySchema,
  );
  await seedUsers();
  await ensureSalesAdminUser();
  await ensureNumberManagementUser();
  await seedPricingCatalog();

  const legacyImports = [
    [MAINTENANCE_MIGRATIONS.LEGACY_USERS, "legacy users import", importLegacyUsers],
    [
      MAINTENANCE_MIGRATIONS.LEGACY_QUOTATIONS,
      "legacy quotations import",
      importLegacyQuotations,
    ],
    [MAINTENANCE_MIGRATIONS.LEGACY_PRICING, "legacy pricing import", importLegacyPricing],
  ];
  for (const [migrationKey, label, operation] of legacyImports) {
    try {
      await runTrackedOperation(migrationKey, label, operation);
    } catch (error) {
      console.warn(
        `[db] ${label} skipped:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.log("[db] Schema ready and seed data applied (multi-schema v2 + RLS).");
}

export async function migrateDatabase() {
  if (String(process.env.SKIP_MIGRATE || "").toLowerCase() === "true") {
    console.log("[db] Migration skipped (SKIP_MIGRATE=true).");
    return;
  }

  const lockClient = await pool.connect();
  try {
    // Deploy script and service boot can overlap. Only one process may migrate.
    await lockClient.query(
      `SELECT pg_advisory_lock(hashtext('worktual_accounts_schema_migration'))`,
    );
    await migrateDatabaseUnlocked();
  } finally {
    try {
      await lockClient.query(
        `SELECT pg_advisory_unlock(hashtext('worktual_accounts_schema_migration'))`,
      );
    } catch {
      // Connection close also releases the session advisory lock.
    }
    lockClient.release();
  }
}
