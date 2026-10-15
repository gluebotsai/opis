-- Ensure every CRM table carries an organization (tenant) id.
-- Backfill from parent rows; never invent a default tenant.

-- ---------------------------------------------------------------------------
-- 1. Add nullable columns
-- ---------------------------------------------------------------------------
ALTER TABLE "company_locations" ADD COLUMN IF NOT EXISTS "organization_id" UUID;
ALTER TABLE "deal_activities" ADD COLUMN IF NOT EXISTS "organization_id" UUID;
ALTER TABLE "user_integration_connections" ADD COLUMN IF NOT EXISTS "organization_id" UUID;
ALTER TABLE "product_addon_tiers" ADD COLUMN IF NOT EXISTS "organization_id" UUID;
ALTER TABLE "quote_lines" ADD COLUMN IF NOT EXISTS "organization_id" UUID;
ALTER TABLE "order_lines" ADD COLUMN IF NOT EXISTS "organization_id" UUID;
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "organization_id" UUID;
ALTER TABLE "meeting_transcript_chunks" ADD COLUMN IF NOT EXISTS "organization_id" UUID;

-- ---------------------------------------------------------------------------
-- 2. Backfill from parents
-- ---------------------------------------------------------------------------
UPDATE "company_locations" AS loc
SET "organization_id" = c."organization_id"
FROM "companies" AS c
WHERE c."id" = loc."company_id"
  AND loc."organization_id" IS NULL;

UPDATE "deal_activities" AS da
SET "organization_id" = d."organization_id"
FROM "deals" AS d
WHERE d."id" = da."deal_id"
  AND da."organization_id" IS NULL;

UPDATE "quote_lines" AS ql
SET "organization_id" = q."organization_id"
FROM "quotes" AS q
WHERE q."id" = ql."quote_id"
  AND ql."organization_id" IS NULL;

UPDATE "order_lines" AS ol
SET "organization_id" = o."organization_id"
FROM "sales_orders" AS o
WHERE o."id" = ol."order_id"
  AND ol."organization_id" IS NULL;

UPDATE "invoice_lines" AS il
SET "organization_id" = i."organization_id"
FROM "invoices" AS i
WHERE i."id" = il."invoice_id"
  AND il."organization_id" IS NULL;

UPDATE "product_addon_tiers" AS t
SET "organization_id" = a."organization_id"
FROM "product_addons" AS a
WHERE a."id" = t."addon_id"
  AND t."organization_id" IS NULL;

UPDATE "meeting_transcript_chunks" AS c
SET "organization_id" = s."organization_id"
FROM "meeting_assist_sessions" AS s
WHERE s."id" = c."session_id"
  AND c."organization_id" IS NULL;

UPDATE "user_integration_connections" AS uic
SET "organization_id" = su."organization_id"
FROM accounts.setup_users AS su
WHERE su."id" = uic."user_id"
  AND su."organization_id" IS NOT NULL
  AND uic."organization_id" IS NULL;

-- Drop OAuth rows that cannot be tenant-scoped (user has no organization).
DELETE FROM "user_integration_connections"
WHERE "organization_id" IS NULL;

-- contact_profiles: require tenant (was nullable)
UPDATE "contact_profiles" AS cp
SET "organization_id" = c."organization_id"
FROM "companies" AS c
WHERE c."id" = cp."company_id"
  AND cp."organization_id" IS NULL;

UPDATE "contact_profiles" AS cp
SET "organization_id" = sub.org
FROM (
  SELECT "contact_id", (MAX("organization_id"::text))::uuid AS org
  FROM "contact_activities"
  GROUP BY "contact_id"
) AS sub
WHERE sub."contact_id" = cp."account_contact_id"
  AND cp."organization_id" IS NULL;

-- Orphan profiles with no resolvable tenant cannot stay after NOT NULL.
DELETE FROM "contact_profiles"
WHERE "organization_id" IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Enforce NOT NULL
-- ---------------------------------------------------------------------------
ALTER TABLE "company_locations" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "deal_activities" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "user_integration_connections" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "product_addon_tiers" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "quote_lines" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "order_lines" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "invoice_lines" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "meeting_transcript_chunks" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "contact_profiles" ALTER COLUMN "organization_id" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "company_locations_organization_id_idx"
  ON "company_locations"("organization_id");
CREATE INDEX IF NOT EXISTS "company_locations_organization_id_company_id_idx"
  ON "company_locations"("organization_id", "company_id");

CREATE INDEX IF NOT EXISTS "deal_activities_organization_id_idx"
  ON "deal_activities"("organization_id");
CREATE INDEX IF NOT EXISTS "deal_activities_organization_id_deal_id_created_at_idx"
  ON "deal_activities"("organization_id", "deal_id", "created_at");

CREATE INDEX IF NOT EXISTS "user_integration_connections_organization_id_idx"
  ON "user_integration_connections"("organization_id");
CREATE INDEX IF NOT EXISTS "user_integration_connections_organization_id_user_id_idx"
  ON "user_integration_connections"("organization_id", "user_id");

CREATE INDEX IF NOT EXISTS "product_addon_tiers_organization_id_idx"
  ON "product_addon_tiers"("organization_id");
CREATE INDEX IF NOT EXISTS "product_addon_tiers_organization_id_addon_id_idx"
  ON "product_addon_tiers"("organization_id", "addon_id");

CREATE INDEX IF NOT EXISTS "quote_lines_organization_id_idx"
  ON "quote_lines"("organization_id");
CREATE INDEX IF NOT EXISTS "quote_lines_organization_id_quote_id_idx"
  ON "quote_lines"("organization_id", "quote_id");

CREATE INDEX IF NOT EXISTS "order_lines_organization_id_idx"
  ON "order_lines"("organization_id");
CREATE INDEX IF NOT EXISTS "order_lines_organization_id_order_id_idx"
  ON "order_lines"("organization_id", "order_id");

CREATE INDEX IF NOT EXISTS "invoice_lines_organization_id_idx"
  ON "invoice_lines"("organization_id");
CREATE INDEX IF NOT EXISTS "invoice_lines_organization_id_invoice_id_idx"
  ON "invoice_lines"("organization_id", "invoice_id");

CREATE INDEX IF NOT EXISTS "meeting_transcript_chunks_organization_id_idx"
  ON "meeting_transcript_chunks"("organization_id");
CREATE INDEX IF NOT EXISTS "meeting_transcript_chunks_organization_id_session_id_idx"
  ON "meeting_transcript_chunks"("organization_id", "session_id");
