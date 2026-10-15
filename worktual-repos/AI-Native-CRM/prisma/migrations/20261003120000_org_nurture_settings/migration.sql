CREATE TABLE IF NOT EXISTS "crm"."org_nurture_settings" (
  "id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "nurture_call_enabled" BOOLEAN NOT NULL DEFAULT false,
  "nurture_call_delay_minutes" INTEGER NOT NULL DEFAULT 15,
  "updated_by_user_id" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "org_nurture_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_nurture_settings_organization_id_key"
  ON "crm"."org_nurture_settings"("organization_id");
