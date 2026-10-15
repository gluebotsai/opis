-- Track send attempts per recipient (max 3 before permanent failed)

ALTER TABLE "campaign_send_recipients"
  ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER NOT NULL DEFAULT 0;
