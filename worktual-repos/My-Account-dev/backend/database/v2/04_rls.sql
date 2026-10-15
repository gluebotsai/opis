-- Session helpers + FORCE RLS for multi-tenancy.
-- App must SET app.is_staff / app.organization_id per request (see server/db/tenantContext.js).

CREATE OR REPLACE FUNCTION platform.rls_org_ok(p_organization_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    current_setting('app.is_staff', true) = 'true'
    OR (
      p_organization_id IS NOT NULL
      AND p_organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
    );
$$;

CREATE OR REPLACE FUNCTION platform.rls_entitled(p_organization_id UUID, p_product_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT platform.rls_org_ok(p_organization_id)
    AND (
      current_setting('app.is_staff', true) = 'true'
      OR EXISTS (
        SELECT 1
        FROM accounts.subscriptions s
        WHERE s.organization_id = p_organization_id
          AND s.product_id = p_product_id
          AND s.status = 'active'
      )
    );
$$;

CREATE OR REPLACE FUNCTION platform.set_tenant(p_organization_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.organization_id', COALESCE(p_organization_id::text, ''), true);
  PERFORM set_config('app.is_staff', 'false', true);
END;
$$;

CREATE OR REPLACE FUNCTION platform.set_staff_mode()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.is_staff', 'true', true);
  PERFORM set_config('app.organization_id', '', true);
END;
$$;

-- Apply tenant RLS to a table that has organization_id (or organizations.id).
CREATE OR REPLACE FUNCTION platform.ensure_tenant_rls(p_schema text, p_table text, p_org_column text DEFAULT 'organization_id')
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  fq text := format('%I.%I', p_schema, p_table);
  pol text := 'tenant_isolation';
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', fq);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', fq);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', pol, fq);
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR ALL USING (platform.rls_org_ok(%I)) WITH CHECK (platform.rls_org_ok(%I))',
    pol, fq, p_org_column, p_org_column
  );
END;
$$;

CREATE OR REPLACE FUNCTION platform.ensure_entitled_rls(
  p_schema text,
  p_table text,
  p_product_id text,
  p_org_column text DEFAULT 'organization_id'
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  fq text := format('%I.%I', p_schema, p_table);
  pol text := 'tenant_isolation';
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', fq);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', fq);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', pol, fq);
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR ALL USING (platform.rls_entitled(%I, %L)) WITH CHECK (platform.rls_entitled(%I, %L))',
    pol, fq, p_org_column, p_product_id, p_org_column, p_product_id
  );
END;
$$;

-- accounts tenant tables
SELECT platform.ensure_tenant_rls('accounts', 'organizations', 'id');
SELECT platform.ensure_tenant_rls('accounts', 'organization_locations');
SELECT platform.ensure_tenant_rls('accounts', 'leads');
SELECT platform.ensure_tenant_rls('accounts', 'lead_assignments');
SELECT platform.ensure_tenant_rls('accounts', 'additional_addresses');
SELECT platform.ensure_tenant_rls('accounts', 'branches');
SELECT platform.ensure_tenant_rls('accounts', 'quote_sessions');
SELECT platform.ensure_tenant_rls('accounts', 'quotations');
SELECT platform.ensure_tenant_rls('accounts', 'product_assignments');
SELECT platform.ensure_tenant_rls('accounts', 'product_summary_items');
SELECT platform.ensure_tenant_rls('accounts', 'quotation_invoices');
SELECT platform.ensure_tenant_rls('accounts', 'payments');
SELECT platform.ensure_tenant_rls('accounts', 'quotation_branch_payments');
SELECT platform.ensure_tenant_rls('accounts', 'payment_webhook_events');
SELECT platform.ensure_tenant_rls('accounts', 'active_products');
SELECT platform.ensure_tenant_rls('accounts', 'subscriptions');
SELECT platform.ensure_tenant_rls('accounts', 'subscription_entitlements');
SELECT platform.ensure_tenant_rls('accounts', 'purchase_orders');
SELECT platform.ensure_tenant_rls('accounts', 'subscription_items');
SELECT platform.ensure_tenant_rls('accounts', 'customer_users');
SELECT platform.ensure_tenant_rls('accounts', 'customer_auth_sessions');
SELECT platform.ensure_tenant_rls('accounts', 'product_access_grants');
SELECT platform.ensure_tenant_rls('accounts', 'usage_metrics');
SELECT platform.ensure_tenant_rls('accounts', 'usage_metrics_monthly');
SELECT platform.ensure_tenant_rls('accounts', 'product_go_live');
SELECT platform.ensure_tenant_rls('accounts', 'renewal_events');
SELECT platform.ensure_tenant_rls('accounts', 'subscription_invoices');
SELECT platform.ensure_tenant_rls('accounts', 'support_tickets');
SELECT platform.ensure_tenant_rls('accounts', 'support_ticket_messages');
SELECT platform.ensure_tenant_rls('accounts', 'customer_product_requests');
SELECT platform.ensure_tenant_rls('accounts', 'branch_cancellation_requests');
SELECT platform.ensure_tenant_rls('accounts', 'branch_cancellation_alerts');
SELECT platform.ensure_tenant_rls('accounts', 'branch_add_requests');
SELECT platform.ensure_tenant_rls('accounts', 'partner_commission_entries');

-- product schemas (entitlement-aware)
SELECT platform.ensure_entitled_rls('crm', 'accounts', 'crm');
SELECT platform.ensure_entitled_rls('crm', 'contacts', 'crm');
SELECT platform.ensure_entitled_rls('cvm', 'value_scores', 'value-management');
SELECT platform.ensure_entitled_rls('ticketing', 'tickets', 'ticketing');
SELECT platform.ensure_entitled_rls('ccass', 'agents', 'contact-center');
SELECT platform.ensure_entitled_rls('cdp', 'profiles', 'cdp');
SELECT platform.ensure_entitled_rls('campaign', 'campaigns', 'campaign');
