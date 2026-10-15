-- Store-phase campaign: details + all channels + frozen audience refs

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "goal" TEXT,
  ADD COLUMN IF NOT EXISTS "objective" TEXT,
  ADD COLUMN IF NOT EXISTS "session_id" UUID,
  ADD COLUMN IF NOT EXISTS "audience_summary" TEXT,
  ADD COLUMN IF NOT EXISTS "audience_filters" JSONB,
  ADD COLUMN IF NOT EXISTS "audience_count" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_session_id_key"
  ON "campaigns"("session_id");

CREATE TABLE IF NOT EXISTS "campaign_channels" (
  "id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "channel" TEXT NOT NULL,
  "template_id" UUID,
  "how_it_works" TEXT,
  "planned_launch_at" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ready',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campaign_channels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_channels_campaign_id_channel_key"
  ON "campaign_channels"("campaign_id", "channel");

CREATE INDEX IF NOT EXISTS "campaign_channels_tenant_id_idx"
  ON "campaign_channels"("tenant_id");

CREATE INDEX IF NOT EXISTS "campaign_channels_template_id_idx"
  ON "campaign_channels"("template_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_channels_campaign_id_fkey'
  ) THEN
    ALTER TABLE "campaign_channels"
      ADD CONSTRAINT "campaign_channels_campaign_id_fkey"
      FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "campaign_audience" (
  "campaign_id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campaign_audience_pkey" PRIMARY KEY ("campaign_id", "contact_id")
);

CREATE INDEX IF NOT EXISTS "campaign_audience_contact_id_idx"
  ON "campaign_audience"("contact_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_audience_campaign_id_fkey'
  ) THEN
    ALTER TABLE "campaign_audience"
      ADD CONSTRAINT "campaign_audience_campaign_id_fkey"
      FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
