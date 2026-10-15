-- Track every open/click hit on send recipients (not just first event).
ALTER TABLE "campaign_send_recipients"
  ADD COLUMN "open_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "click_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "campaign_send_recipients"
SET "open_count" = 1
WHERE "opened_at" IS NOT NULL AND "open_count" = 0;

UPDATE "campaign_send_recipients"
SET "click_count" = 1
WHERE "clicked_at" IS NOT NULL AND "click_count" = 0;
