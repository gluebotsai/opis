-- Multi-channel send batches + push destinations

ALTER TABLE "campaign_send_batches"
  ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'email';

ALTER TABLE "campaign_send_batches"
  DROP CONSTRAINT IF EXISTS "campaign_send_batches_campaign_id_seq_key";

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_send_batches_campaign_id_channel_seq_key"
  ON "campaign_send_batches"("campaign_id", "channel", "seq");

CREATE INDEX IF NOT EXISTS "campaign_send_batches_tenant_id_channel_status_scheduled_for_idx"
  ON "campaign_send_batches"("tenant_id", "channel", "status", "scheduled_for");

ALTER TABLE "campaign_send_recipients"
  ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "campaign_send_recipients"
  ADD COLUMN IF NOT EXISTS "destination" TEXT;

ALTER TABLE "campaign_send_recipients"
  ADD COLUMN IF NOT EXISTS "platform" TEXT;

UPDATE "campaign_send_recipients"
SET "destination" = "email"
WHERE "destination" IS NULL AND "email" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "push_endpoints" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID,
    "channel" TEXT NOT NULL,
    "platform" TEXT,
    "endpoint" TEXT NOT NULL,
    "auth_keys" JSONB,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "push_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_endpoints_tenant_id_channel_endpoint_key"
  ON "push_endpoints"("tenant_id", "channel", "endpoint");

CREATE INDEX IF NOT EXISTS "push_endpoints_tenant_id_contact_id_channel_idx"
  ON "push_endpoints"("tenant_id", "contact_id", "channel");

CREATE INDEX IF NOT EXISTS "push_endpoints_tenant_id_channel_active_idx"
  ON "push_endpoints"("tenant_id", "channel", "active");
