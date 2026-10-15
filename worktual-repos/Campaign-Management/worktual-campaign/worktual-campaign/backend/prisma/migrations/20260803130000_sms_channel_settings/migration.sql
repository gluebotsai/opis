-- SMS channel settings (campaign schema)
CREATE TABLE "sms_channel_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "settings" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'not_started',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sms_channel_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sms_channel_settings_tenant_id_key"
  ON "sms_channel_settings"("tenant_id");
