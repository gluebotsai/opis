-- Store campaign context on regulated WhatsApp templates for approved/rejected agent flows.
ALTER TABLE "regulated_channel_templates"
  ADD COLUMN IF NOT EXISTS "campaign_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "goal" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "objective" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "source_campaign_id" UUID;
