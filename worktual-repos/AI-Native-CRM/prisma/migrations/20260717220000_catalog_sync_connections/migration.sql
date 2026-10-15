-- Catalog sync connectors + product SKU lookup index
CREATE TYPE "CatalogSyncProvider" AS ENUM ('shopify', 'woocommerce', 'custom_feed');
CREATE TYPE "CatalogConnectionStatus" AS ENUM ('disconnected', 'connected', 'error');

CREATE TABLE "catalog_integration_connections" (
  "id" TEXT NOT NULL,
  "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  "provider" "CatalogSyncProvider" NOT NULL,
  "status" "CatalogConnectionStatus" NOT NULL DEFAULT 'disconnected',
  "store_url" TEXT,
  "api_key" TEXT,
  "api_secret" TEXT,
  "last_sync_at" TIMESTAMP(3),
  "last_sync_status" TEXT,
  "last_sync_message" TEXT,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_integration_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalog_integration_connections_organization_id_provider_key"
  ON "catalog_integration_connections" ("organization_id", "provider");

CREATE INDEX "catalog_integration_connections_organization_id_idx"
  ON "catalog_integration_connections" ("organization_id");

CREATE INDEX "products_organization_id_sku_idx"
  ON "products" ("organization_id", "sku");
