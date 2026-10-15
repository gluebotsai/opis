-- AlterTable
ALTER TABLE "contact_activities" ADD COLUMN IF NOT EXISTS "reminder_sent_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contact_activities_type_due_at_reminder_sent_at_idx"
  ON "contact_activities"("type", "due_at", "reminder_sent_at");
