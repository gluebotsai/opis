-- Move legacy public tables into platform / accounts (idempotent).
-- Run AFTER database/schema.sql has created objects in public.

DO $$
DECLARE
  platform_tables text[] := ARRAY[
    'users',
    'auth_sessions',
    'pricing_catalogs',
    'export_audit_logs',
    'mail_oauth_connections',
    'mail_oauth_states',
    'email_outbox',
    'graph_mail_subscriptions',
    'mail_signatures',
    'resellers',
    'reseller_users',
    'reseller_auth_sessions',
    'partners',
    'partner_users',
    'partner_auth_sessions',
    'partner_bank_accounts',
    'commission_slabs',
    'password_reset_otps'
  ];
  accounts_tables text[] := ARRAY[
    'leads',
    'lead_assignments',
    'additional_addresses',
    'branches',
    'quote_sessions',
    'quotations',
    'product_assignments',
    'product_summary_items',
    'quotation_invoices',
    'payments',
    'quotation_branch_payments',
    'payment_webhook_events',
    'active_products',
    'organizations',
    'organization_locations',
    'subscriptions',
    'subscription_entitlements',
    'purchase_orders',
    'subscription_items',
    'customer_users',
    'customer_auth_sessions',
    'product_access_grants',
    'usage_metrics',
    'usage_metrics_monthly',
    'product_go_live',
    'renewal_events',
    'subscription_invoices',
    'support_tickets',
    'support_ticket_messages',
    'customer_product_requests',
    'branch_cancellation_requests',
    'branch_cancellation_alerts',
    'branch_add_requests',
    'partner_commission_entries'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY platform_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'platform' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA platform', t);
    END IF;
  END LOOP;

  FOREACH t IN ARRAY accounts_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'accounts' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA accounts', t);
    END IF;
  END LOOP;
END $$;
