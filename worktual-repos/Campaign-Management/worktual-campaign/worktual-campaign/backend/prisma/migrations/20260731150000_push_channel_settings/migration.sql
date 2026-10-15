-- Editable web_push / app_push configuration (field collection)

CREATE TABLE IF NOT EXISTS "push_channel_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "push_channel_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_channel_settings_tenant_id_channel_key"
  ON "push_channel_settings"("tenant_id", "channel");

CREATE INDEX IF NOT EXISTS "push_channel_settings_tenant_id_idx"
  ON "push_channel_settings"("tenant_id");
