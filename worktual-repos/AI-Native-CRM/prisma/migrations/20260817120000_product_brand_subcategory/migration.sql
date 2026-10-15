-- Common catalog merchandising fields for B2B / B2C / B2B2C (crm.products only).
ALTER TABLE "products" ADD COLUMN "brand" TEXT;
ALTER TABLE "products" ADD COLUMN "subcategory" TEXT;

CREATE INDEX "products_organization_id_brand_idx" ON "products"("organization_id", "brand");
