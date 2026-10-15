-- Generic CRM Finance Phase 3: contracts, billing schedules, renewal orchestration

CREATE TYPE "crm"."ContractStatus" AS ENUM ('active', 'expired', 'cancelled');
CREATE TYPE "crm"."ContractBillingScheduleStatus" AS ENUM ('scheduled', 'generated', 'cancelled');

ALTER TABLE "crm"."org_finance_settings"
  ADD COLUMN IF NOT EXISTS "billing_cutoff_day" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "renewal_window_days" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "auto_renew_default" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "renewal_quote_auto_create" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "crm"."quotes"
  ADD COLUMN IF NOT EXISTS "renewal_contract_id" TEXT;

CREATE INDEX IF NOT EXISTS "quotes_renewal_contract_id_idx"
  ON "crm"."quotes"("renewal_contract_id");

ALTER TABLE "crm"."contracts"
  ADD COLUMN IF NOT EXISTS "auto_renew" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "status" "crm"."ContractStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "source_order_id" TEXT,
  ADD COLUMN IF NOT EXISTS "billing_frequency" "crm"."ProductBillingFrequency",
  ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancel_reason" TEXT;

CREATE INDEX IF NOT EXISTS "contracts_organization_id_status_ends_at_idx"
  ON "crm"."contracts"("organization_id", "status", "ends_at");

CREATE INDEX IF NOT EXISTS "contracts_renew_deal_id_idx"
  ON "crm"."contracts"("renew_deal_id");

ALTER TABLE "crm"."contracts"
  ADD CONSTRAINT "contracts_source_order_id_fkey"
  FOREIGN KEY ("source_order_id") REFERENCES "crm"."sales_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crm"."invoices"
  ADD COLUMN IF NOT EXISTS "contract_id" TEXT,
  ADD COLUMN IF NOT EXISTS "billing_schedule_id" TEXT;

CREATE INDEX IF NOT EXISTS "invoices_contract_id_idx"
  ON "crm"."invoices"("contract_id");

CREATE INDEX IF NOT EXISTS "invoices_billing_schedule_id_idx"
  ON "crm"."invoices"("billing_schedule_id");

CREATE TABLE IF NOT EXISTS "crm"."contract_billing_schedules" (
  "id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "billing_kind" "crm"."InvoiceBillingKind" NOT NULL,
  "scheduled_for" DATE NOT NULL,
  "status" "crm"."ContractBillingScheduleStatus" NOT NULL DEFAULT 'scheduled',
  "invoice_id" TEXT,
  "amount" DECIMAL(12,2),
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "contract_billing_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contract_billing_schedules_organization_id_idempotency_key_key"
  ON "crm"."contract_billing_schedules"("organization_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "contract_billing_schedules_organization_id_status_scheduled_for_idx"
  ON "crm"."contract_billing_schedules"("organization_id", "status", "scheduled_for");

CREATE INDEX IF NOT EXISTS "contract_billing_schedules_contract_id_idx"
  ON "crm"."contract_billing_schedules"("contract_id");

ALTER TABLE "crm"."contract_billing_schedules"
  ADD CONSTRAINT "contract_billing_schedules_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "crm"."contracts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm"."invoices"
  ADD CONSTRAINT "invoices_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "crm"."contracts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crm"."invoices"
  ADD CONSTRAINT "invoices_billing_schedule_id_fkey"
  FOREIGN KEY ("billing_schedule_id") REFERENCES "crm"."contract_billing_schedules"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
