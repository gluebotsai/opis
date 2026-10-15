-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('draft', 'sent', 'accepted', 'rejected', 'void');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('draft', 'confirmed', 'fulfilled', 'cancelled');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'sent', 'paid', 'void', 'overdue');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('create', 'update', 'delete', 'stage_change', 'assign', 'convert', 'quote_sent', 'quote_accepted', 'order_created', 'invoice_created');

-- DropIndex
DROP INDEX "contact_activities_rfc_message_id_idx";

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "contact_activities" ADD COLUMN     "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "expected_close_date" TIMESTAMP(3),
ADD COLUMN     "lost_reason" TEXT,
ADD COLUMN     "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "deal_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "QuoteStatus" NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valid_until" TIMESTAMP(3),
    "notes" TEXT,
    "sent_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "product_id" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "deal_id" TEXT,
    "quote_id" TEXT,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'confirmed',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "confirmed_at" TIMESTAMP(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "order_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "due_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "company_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "arr" DECIMAL(12,2),
    "renew_deal_id" TEXT,
    "renewal_reminded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_tickets" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "company_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "contact_id" UUID,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "assignee_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "actor_user_id" UUID,
    "action" "AuditAction" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_snapshots" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotes_organization_id_deal_id_idx" ON "quotes"("organization_id", "deal_id");

-- CreateIndex
CREATE INDEX "quotes_organization_id_status_created_at_idx" ON "quotes"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "quotes_deal_id_idx" ON "quotes"("deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_organization_id_number_version_key" ON "quotes"("organization_id", "number", "version");

-- CreateIndex
CREATE INDEX "quote_lines_quote_id_idx" ON "quote_lines"("quote_id");

-- CreateIndex
CREATE INDEX "sales_orders_organization_id_status_created_at_idx" ON "sales_orders"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "sales_orders_company_id_idx" ON "sales_orders"("company_id");

-- CreateIndex
CREATE INDEX "sales_orders_deal_id_idx" ON "sales_orders"("deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_organization_id_number_key" ON "sales_orders"("organization_id", "number");

-- CreateIndex
CREATE INDEX "order_lines_order_id_idx" ON "order_lines"("order_id");

-- CreateIndex
CREATE INDEX "invoices_organization_id_status_created_at_idx" ON "invoices"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "invoices_company_id_idx" ON "invoices"("company_id");

-- CreateIndex
CREATE INDEX "invoices_order_id_idx" ON "invoices"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_number_key" ON "invoices"("organization_id", "number");

-- CreateIndex
CREATE INDEX "contracts_organization_id_ends_at_idx" ON "contracts"("organization_id", "ends_at");

-- CreateIndex
CREATE INDEX "contracts_company_id_idx" ON "contracts"("company_id");

-- CreateIndex
CREATE INDEX "contracts_ends_at_renewal_reminded_at_idx" ON "contracts"("ends_at", "renewal_reminded_at");

-- CreateIndex
CREATE INDEX "service_tickets_organization_id_status_created_at_idx" ON "service_tickets"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "service_tickets_company_id_idx" ON "service_tickets"("company_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "report_snapshots_organization_id_kind_generated_at_idx" ON "report_snapshots"("organization_id", "kind", "generated_at");

-- CreateIndex
CREATE INDEX "companies_organization_id_idx" ON "companies"("organization_id");

-- CreateIndex
CREATE INDEX "companies_organization_id_updated_at_idx" ON "companies"("organization_id", "updated_at");

-- CreateIndex
CREATE INDEX "companies_owner_user_id_updated_at_idx" ON "companies"("owner_user_id", "updated_at");

-- CreateIndex
CREATE INDEX "contact_activities_organization_id_contact_id_created_at_idx" ON "contact_activities"("organization_id", "contact_id", "created_at");

-- CreateIndex
CREATE INDEX "contact_activities_organization_id_folder_created_at_idx" ON "contact_activities"("organization_id", "folder", "created_at");

-- CreateIndex
CREATE INDEX "deals_organization_id_idx" ON "deals"("organization_id");

-- CreateIndex
CREATE INDEX "deals_organization_id_stage_updated_at_idx" ON "deals"("organization_id", "stage", "updated_at");

-- CreateIndex
CREATE INDEX "deals_owner_user_id_stage_idx" ON "deals"("owner_user_id", "stage");

-- CreateIndex
CREATE INDEX "deals_company_id_stage_idx" ON "deals"("company_id", "stage");

-- CreateIndex
CREATE INDEX "products_organization_id_idx" ON "products"("organization_id");

-- CreateIndex
CREATE INDEX "products_organization_id_status_idx" ON "products"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_tickets" ADD CONSTRAINT "service_tickets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_tickets" ADD CONSTRAINT "service_tickets_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
