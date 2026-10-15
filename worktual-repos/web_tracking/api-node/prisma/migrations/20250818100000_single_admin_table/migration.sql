-- Consolidate domains into admin_accounts (one Postgres auth table).

ALTER TABLE "admin_accounts" ADD COLUMN IF NOT EXISTS "site_type" TEXT NOT NULL DEFAULT 'blog';
ALTER TABLE "admin_accounts" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "admin_accounts" ADD COLUMN IF NOT EXISTS "organization_id" UUID;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'domains') THEN
    UPDATE "admin_accounts" AS a
    SET
      site_type = d.site_type,
      status = d.status,
      updated_at = GREATEST(a.updated_at, d.updated_at)
    FROM "domains" AS d
    WHERE a.domain_id = d.domain_id;
  END IF;
END $$;

ALTER TABLE "admin_accounts" DROP CONSTRAINT IF EXISTS "admin_accounts_domain_id_fkey";

CREATE UNIQUE INDEX IF NOT EXISTS "admin_accounts_domain_id_key" ON "admin_accounts"("domain_id");

DROP TABLE IF EXISTS "domains";
