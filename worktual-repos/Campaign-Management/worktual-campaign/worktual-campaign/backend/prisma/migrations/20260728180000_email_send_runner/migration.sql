-- Email send runner foundation + caps health_stats

ALTER TABLE "email_sending_caps" ADD COLUMN IF NOT EXISTS "health_stats" JSONB;

CREATE TABLE IF NOT EXISTS "email_suppressions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_suppressions_tenant_id_email_key"
  ON "email_suppressions"("tenant_id", "email");
CREATE INDEX IF NOT EXISTS "email_suppressions_tenant_id_idx"
  ON "email_suppressions"("tenant_id");

CREATE TABLE IF NOT EXISTS "campaign_send_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "size" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaign_send_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_send_batches_campaign_id_seq_key"
  ON "campaign_send_batches"("campaign_id", "seq");
CREATE INDEX IF NOT EXISTS "campaign_send_batches_tenant_id_status_scheduled_for_idx"
  ON "campaign_send_batches"("tenant_id", "status", "scheduled_for");

CREATE TABLE IF NOT EXISTS "campaign_send_recipients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "skip_fail_reason" TEXT,
    "provider_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaign_send_recipients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "campaign_send_recipients_batch_id_status_idx"
  ON "campaign_send_recipients"("batch_id", "status");
CREATE INDEX IF NOT EXISTS "campaign_send_recipients_campaign_id_status_idx"
  ON "campaign_send_recipients"("campaign_id", "status");
CREATE INDEX IF NOT EXISTS "campaign_send_recipients_tenant_id_email_idx"
  ON "campaign_send_recipients"("tenant_id", "email");

DO $$ BEGIN
  ALTER TABLE "campaign_send_batches"
    ADD CONSTRAINT "campaign_send_batches_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "campaign_send_recipients"
    ADD CONSTRAINT "campaign_send_recipients_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "campaign_send_batches"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
