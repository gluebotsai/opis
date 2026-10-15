-- Universal catalog: offers, price books, meter clarity on addons.

CREATE TYPE "AddonMeterKey" AS ENUM ('seat', 'minute', 'session', 'email', 'agent', 'flat', 'custom');

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "custom_attributes" JSONB;

ALTER TABLE "product_addons"
  ADD COLUMN IF NOT EXISTS "meter_key" "AddonMeterKey",
  ADD COLUMN IF NOT EXISTS "is_overage" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "product_offers" (
  "id" TEXT NOT NULL,
  "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  "product_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "billing_type" "ProductBillingType",
  "billing_frequency" "ProductBillingFrequency",
  "included_qty" INTEGER,
  "meter_key" "AddonMeterKey",
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" "ProductStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_offers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "price_books" (
  "id" TEXT NOT NULL,
  "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  "name" TEXT NOT NULL,
  "code" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "price_books_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "price_book_entries" (
  "id" TEXT NOT NULL,
  "organization_id" UUID NOT NULL,
  "price_book_id" TEXT NOT NULL,
  "product_id" TEXT,
  "offer_id" TEXT,
  "addon_id" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "billing_frequency" "ProductBillingFrequency",
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "price_book_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "product_offers_product_id_idx" ON "product_offers"("product_id");
CREATE INDEX IF NOT EXISTS "product_offers_organization_id_idx" ON "product_offers"("organization_id");
CREATE INDEX IF NOT EXISTS "product_offers_organization_id_product_id_idx" ON "product_offers"("organization_id", "product_id");

CREATE INDEX IF NOT EXISTS "price_books_organization_id_idx" ON "price_books"("organization_id");
CREATE INDEX IF NOT EXISTS "price_books_organization_id_is_default_idx" ON "price_books"("organization_id", "is_default");

CREATE INDEX IF NOT EXISTS "price_book_entries_price_book_id_idx" ON "price_book_entries"("price_book_id");
CREATE INDEX IF NOT EXISTS "price_book_entries_organization_id_idx" ON "price_book_entries"("organization_id");
CREATE INDEX IF NOT EXISTS "price_book_entries_product_id_idx" ON "price_book_entries"("product_id");
CREATE INDEX IF NOT EXISTS "price_book_entries_offer_id_idx" ON "price_book_entries"("offer_id");
CREATE INDEX IF NOT EXISTS "price_book_entries_addon_id_idx" ON "price_book_entries"("addon_id");
CREATE INDEX IF NOT EXISTS "price_book_entries_organization_id_price_book_id_idx" ON "price_book_entries"("organization_id", "price_book_id");

DO $$ BEGIN
  ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "price_book_entries" ADD CONSTRAINT "price_book_entries_price_book_id_fkey"
    FOREIGN KEY ("price_book_id") REFERENCES "price_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "price_book_entries" ADD CONSTRAINT "price_book_entries_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "price_book_entries" ADD CONSTRAINT "price_book_entries_offer_id_fkey"
    FOREIGN KEY ("offer_id") REFERENCES "product_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "price_book_entries" ADD CONSTRAINT "price_book_entries_addon_id_fkey"
    FOREIGN KEY ("addon_id") REFERENCES "product_addons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
