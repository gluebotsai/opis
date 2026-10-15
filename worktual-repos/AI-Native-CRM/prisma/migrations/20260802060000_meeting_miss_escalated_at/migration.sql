-- Meeting miss escalation (admins notified when no transcript after grace)
ALTER TABLE "contact_activities" ADD COLUMN IF NOT EXISTS "miss_escalated_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "contact_activities_type_due_at_miss_escalated_at_idx"
  ON "contact_activities"("type", "due_at", "miss_escalated_at");
