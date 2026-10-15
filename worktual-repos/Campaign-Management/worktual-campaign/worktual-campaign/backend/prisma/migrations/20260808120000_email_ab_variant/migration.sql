-- Email A/B: per-recipient variant + open/click timestamps
ALTER TABLE "campaign_send_recipients" ADD COLUMN IF NOT EXISTS "ab_variant" TEXT;
ALTER TABLE "campaign_send_recipients" ADD COLUMN IF NOT EXISTS "opened_at" TIMESTAMP(3);
ALTER TABLE "campaign_send_recipients" ADD COLUMN IF NOT EXISTS "clicked_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "campaign_send_recipients_campaign_id_ab_variant_idx"
  ON "campaign_send_recipients"("campaign_id", "ab_variant");
