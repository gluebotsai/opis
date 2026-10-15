-- Common-table roadmap: org vertical packs + franchise channel hierarchy.
-- CRM schema only — no cdp/accounts DDL.

CREATE TYPE "OrganizationVertical" AS ENUM (
  'general',
  'ecommerce',
  'healthcare',
  'finance',
  'telecom'
);

CREATE TYPE "CompanyChannelRole" AS ENUM (
  'standard',
  'franchise',
  'owned_store',
  'brand_hq'
);

CREATE TABLE IF NOT EXISTS "organization_profiles" (
  "organization_id" BIGINT NOT NULL,
  "vertical" "OrganizationVertical" NOT NULL DEFAULT 'general',
  "vertical_config" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_profiles_pkey" PRIMARY KEY ("organization_id")
);

ALTER TABLE "contact_profiles"
  ADD COLUMN IF NOT EXISTS "custom_attributes" JSONB;

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "channel_role" "CompanyChannelRole" NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS "parent_company_id" TEXT;

CREATE INDEX IF NOT EXISTS "companies_organization_id_channel_role_idx"
  ON "companies" ("organization_id", "channel_role");

CREATE INDEX IF NOT EXISTS "companies_parent_company_id_idx"
  ON "companies" ("parent_company_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_parent_company_id_fkey'
  ) THEN
    ALTER TABLE "companies"
      ADD CONSTRAINT "companies_parent_company_id_fkey"
      FOREIGN KEY ("parent_company_id") REFERENCES "companies"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
