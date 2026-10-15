-- Generic CRM Finance Phase 2: org settings, payment links, gateway webhooks

CREATE TYPE "crm"."InvoicePaymentProvider" AS ENUM ('stripe', 'razorpay');
CREATE TYPE "crm"."InvoicePaymentSessionStatus" AS ENUM ('active', 'expired', 'paid', 'cancelled');
CREATE TYPE "crm"."PaymentGatewayProvider" AS ENUM ('stripe', 'razorpay');

ALTER TYPE "crm"."InvoicePaymentMethod" ADD VALUE IF NOT EXISTS 'stripe';
ALTER TYPE "crm"."InvoicePaymentMethod" ADD VALUE IF NOT EXISTS 'razorpay';

ALTER TABLE "crm"."invoices"
  ADD COLUMN IF NOT EXISTS "payment_provider" "crm"."InvoicePaymentProvider",
  ADD COLUMN IF NOT EXISTS "payment_link_url" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_session_id" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_session_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payment_session_status" "crm"."InvoicePaymentSessionStatus",
  ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_sent_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "crm"."org_finance_settings" (
  "id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "default_payment_terms" TEXT NOT NULL DEFAULT 'Net 30',
  "zero_amount_auto_paid" BOOLEAN NOT NULL DEFAULT true,
  "offline_reference_min_len" INTEGER NOT NULL DEFAULT 4,
  "duplicate_invoice_guard" BOOLEAN NOT NULL DEFAULT true,
  "online_payments_enabled" BOOLEAN NOT NULL DEFAULT true,
  "payment_routing_rules" JSONB,
  "bank_details" JSONB,
  "invoice_number_prefix" TEXT,
  "invoice_number_next_seq" INTEGER NOT NULL DEFAULT 1,
  "stripe_publishable_key" TEXT,
  "stripe_secret_key_enc" TEXT,
  "stripe_webhook_secret_enc" TEXT,
  "razorpay_key_id" TEXT,
  "razorpay_key_secret_enc" TEXT,
  "razorpay_webhook_secret_enc" TEXT,
  "updated_by_user_id" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "org_finance_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_finance_settings_organization_id_key"
  ON "crm"."org_finance_settings"("organization_id");

CREATE TABLE IF NOT EXISTS "crm"."payment_gateway_events" (
  "id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "provider" "crm"."PaymentGatewayProvider" NOT NULL,
  "external_event_id" TEXT NOT NULL,
  "invoice_id" TEXT,
  "payload" JSONB,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_gateway_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_gateway_events_provider_external_event_id_key"
  ON "crm"."payment_gateway_events"("provider", "external_event_id");

CREATE INDEX IF NOT EXISTS "payment_gateway_events_organization_id_processed_at_idx"
  ON "crm"."payment_gateway_events"("organization_id", "processed_at");

CREATE INDEX IF NOT EXISTS "payment_gateway_events_invoice_id_idx"
  ON "crm"."payment_gateway_events"("invoice_id");
