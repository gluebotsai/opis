-- CreateEnum
CREATE TYPE "InvoiceLineKind" AS ENUM ('product', 'addon');

-- AlterTable invoices: optional order, deal link, form metadata
ALTER TABLE "invoices" ALTER COLUMN "order_id" DROP NOT NULL;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "deal_id" TEXT,
  ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "issue_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payment_terms" TEXT,
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "billing_address" TEXT,
  ADD COLUMN IF NOT EXISTS "lead_email" TEXT,
  ADD COLUMN IF NOT EXISTS "lead_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "tax_id" TEXT;

-- Drop old cascade FK on order if present, recreate as SET NULL
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_order_id_fkey";
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_deal_id_fkey"
  FOREIGN KEY ("deal_id") REFERENCES "deals"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "invoices_deal_id_idx" ON "invoices"("deal_id");

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "kind" "InvoiceLineKind" NOT NULL DEFAULT 'product',
    "product_id" TEXT,
    "addon_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,4) NOT NULL,
    "tax_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines"("invoice_id");
CREATE INDEX "invoice_lines_product_id_idx" ON "invoice_lines"("product_id");
CREATE INDEX "invoice_lines_addon_id_idx" ON "invoice_lines"("addon_id");

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_addon_id_fkey"
  FOREIGN KEY ("addon_id") REFERENCES "product_addons"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
