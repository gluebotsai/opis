-- AlterTable
ALTER TABLE "company_locations" ADD COLUMN IF NOT EXISTS "owner_user_id" UUID;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "company_locations_owner_user_id_idx" ON "company_locations"("owner_user_id");
