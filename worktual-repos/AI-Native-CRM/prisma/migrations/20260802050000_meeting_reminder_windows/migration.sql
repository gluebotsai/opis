-- Dual-window meeting reminders (T−24h and T−1h)
ALTER TABLE "contact_activities" ADD COLUMN IF NOT EXISTS "reminder_24h_sent_at" TIMESTAMP(3);
ALTER TABLE "contact_activities" ADD COLUMN IF NOT EXISTS "reminder_1h_sent_at" TIMESTAMP(3);

-- Backfill: prior 1h sends should not re-fire
UPDATE "contact_activities"
SET "reminder_1h_sent_at" = "reminder_sent_at"
WHERE "reminder_sent_at" IS NOT NULL
  AND "reminder_1h_sent_at" IS NULL;

CREATE INDEX IF NOT EXISTS "contact_activities_type_due_at_reminder_24h_sent_at_idx"
  ON "contact_activities"("type", "due_at", "reminder_24h_sent_at");

CREATE INDEX IF NOT EXISTS "contact_activities_type_due_at_reminder_1h_sent_at_idx"
  ON "contact_activities"("type", "due_at", "reminder_1h_sent_at");
