-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ProductStatus" AS ENUM ('draft', 'available', 'unavailable');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "products" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tagline" TEXT,
  "description" TEXT,
  "specifications" TEXT,
  "image_url" TEXT,
  "gallery_urls" JSONB,
  "sku" TEXT,
  "price" DECIMAL(12,2),
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" "ProductStatus" NOT NULL DEFAULT 'draft',
  "category" TEXT,
  "tags" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "products_name_idx" ON "products"("name");
CREATE INDEX IF NOT EXISTS "products_status_idx" ON "products"("status");
CREATE INDEX IF NOT EXISTS "products_category_idx" ON "products"("category");
CREATE INDEX IF NOT EXISTS "products_created_at_idx" ON "products"("created_at");
