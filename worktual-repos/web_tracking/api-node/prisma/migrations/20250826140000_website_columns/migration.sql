-- Rename admin_accounts columns to website_id / website_url; organization_id to INTEGER

ALTER TABLE "admin_accounts" RENAME COLUMN "domain_id" TO "website_id";
ALTER TABLE "admin_accounts" RENAME COLUMN "domain_name" TO "website_url";

ALTER INDEX IF EXISTS "admin_accounts_domain_id_key" RENAME TO "admin_accounts_website_id_key";

ALTER TABLE "admin_accounts"
  ALTER COLUMN "organization_id" TYPE INTEGER
  USING NULL;
