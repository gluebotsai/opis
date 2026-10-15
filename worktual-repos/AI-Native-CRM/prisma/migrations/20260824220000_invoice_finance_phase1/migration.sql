-- Generic Finance Phase 1: billing kind, approval/payment/void audit fields.

CREATE TYPE "crm"."InvoiceBillingKind" AS ENUM (
  'standard',
  'setup',
  'subscription_start',
  'renewal',
  'amendment',
  'adjustment',
  'credit'
);

CREATE TYPE "crm"."InvoicePaymentMethod" AS ENUM ('offline', 'manual');

ALTER TABLE "crm"."invoices"
  ADD COLUMN "approval_note" TEXT,
  ADD COLUMN "billing_kind" "crm"."InvoiceBillingKind" NOT NULL DEFAULT 'standard',
  ADD COLUMN "submitted_for_approval_at" TIMESTAMPTZ,
  ADD COLUMN "resubmitted_at" TIMESTAMPTZ,
  ADD COLUMN "payment_method" "crm"."InvoicePaymentMethod",
  ADD COLUMN "payment_reference" TEXT,
  ADD COLUMN "payment_confirmed_by_user_id" BIGINT,
  ADD COLUMN "payment_confirmed_at" TIMESTAMPTZ,
  ADD COLUMN "voided_at" TIMESTAMPTZ,
  ADD COLUMN "void_reason" TEXT,
  ADD COLUMN "voided_by_user_id" BIGINT;
