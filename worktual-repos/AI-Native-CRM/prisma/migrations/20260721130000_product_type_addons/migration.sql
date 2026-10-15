-- Product status: available → active, unavailable → archived
CREATE TYPE "ProductStatus_new" AS ENUM ('draft', 'active', 'archived');

ALTER TABLE "products" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "products"
  ALTER COLUMN "status" TYPE "ProductStatus_new"
  USING (
    CASE "status"::text
      WHEN 'available' THEN 'active'
      WHEN 'unavailable' THEN 'archived'
      ELSE 'draft'
    END
  )::"ProductStatus_new";

DROP TYPE "ProductStatus";
ALTER TYPE "ProductStatus_new" RENAME TO "ProductStatus";

ALTER TABLE "products" ALTER COLUMN "status" SET DEFAULT 'draft'::"ProductStatus";

-- Product type + addon pricing
CREATE TYPE "ProductType" AS ENUM ('fixed', 'customizable');
CREATE TYPE "AddonPricingModel" AS ENUM ('flat', 'per_unit', 'stepped', 'tiered');

ALTER TABLE "products"
  ADD COLUMN "product_type" "ProductType" NOT NULL DEFAULT 'fixed';

CREATE TABLE "product_addons" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit_label" TEXT,
    "pricing_model" "AddonPricingModel" NOT NULL,
    "flat_price" DECIMAL(12,2),
    "unit_price" DECIMAL(12,4),
    "step_size" INTEGER,
    "step_price" DECIMAL(12,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_addons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_addon_tiers" (
    "id" TEXT NOT NULL,
    "addon_id" TEXT NOT NULL,
    "min_qty" INTEGER NOT NULL,
    "max_qty" INTEGER,
    "unit_price" DECIMAL(12,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_addon_tiers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "products_organization_id_product_type_idx" ON "products"("organization_id", "product_type");
CREATE INDEX "product_addons_product_id_idx" ON "product_addons"("product_id");
CREATE INDEX "product_addons_organization_id_idx" ON "product_addons"("organization_id");
CREATE INDEX "product_addons_organization_id_product_id_idx" ON "product_addons"("organization_id", "product_id");
CREATE INDEX "product_addon_tiers_addon_id_idx" ON "product_addon_tiers"("addon_id");

ALTER TABLE "product_addons"
  ADD CONSTRAINT "product_addons_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_addon_tiers"
  ADD CONSTRAINT "product_addon_tiers_addon_id_fkey"
  FOREIGN KEY ("addon_id") REFERENCES "product_addons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
