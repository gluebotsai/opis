-- Commerce MVP: contact-first orders (B2C / B2B2C)
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "contact_id" UUID;
ALTER TABLE "sales_orders" ALTER COLUMN "company_id" DROP NOT NULL;

-- Drop cascade FK if present and recreate as SET NULL-friendly optional company
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_orders_company_id_fkey'
  ) THEN
    ALTER TABLE "sales_orders" DROP CONSTRAINT "sales_orders_company_id_fkey";
  END IF;
END $$;

ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "sales_orders_contact_id_idx" ON "sales_orders"("contact_id");

ALTER TABLE "invoices" ALTER COLUMN "company_id" DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_company_id_fkey'
  ) THEN
    ALTER TABLE "invoices" DROP CONSTRAINT "invoices_company_id_fkey";
  END IF;
END $$;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
