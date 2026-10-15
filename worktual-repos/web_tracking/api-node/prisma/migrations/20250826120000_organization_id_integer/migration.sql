-- organization_id: UUID -> INTEGER (run manually on Postgres when ready)
ALTER TABLE "admin_accounts"
  ALTER COLUMN "organization_id" TYPE INTEGER
  USING NULL;
