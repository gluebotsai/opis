-- Shared catalog: inventory.products is the common source for all products.
-- Columns are unchanged (no ADD/DROP/RENAME). CRM may SELECT/INSERT/UPDATE/DELETE
-- existing columns only. Further field changes require inventory owners first.
--
-- crm.products becomes a pass-through view so Prisma `?schema=crm` keeps working.
-- Offers, addons, price books, quote/order/invoice lines stay in crm.

CREATE SCHEMA IF NOT EXISTS inventory;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'crm'
      AND table_name = 'products'
      AND table_type = 'BASE TABLE'
  ) THEN
    ALTER TABLE crm.products SET SCHEMA inventory;
  END IF;
END $$;

CREATE OR REPLACE VIEW crm.products AS
SELECT
  id,
  organization_id,
  name,
  tagline,
  description,
  specifications,
  image_url,
  gallery_urls,
  product_url,
  sku,
  brand,
  subcategory,
  stock_on_hand,
  price,
  max_discount_percent,
  currency,
  status,
  product_type,
  category,
  tags,
  billing_type,
  billing_frequency,
  unit_of_measure,
  pricing_tiers,
  custom_attributes,
  created_at,
  updated_at
FROM inventory.products;

COMMENT ON SCHEMA inventory IS
  'Shared product catalog. CRM DML on existing columns only; no DDL. Field changes require inventory owners.';

COMMENT ON TABLE inventory.products IS
  'Common product source for B2B / B2C / B2B2C. Do not ALTER from CRM.';

COMMENT ON VIEW crm.products IS
  'Compatibility view over inventory.products for Prisma search_path=crm. DML only; frozen columns.';
