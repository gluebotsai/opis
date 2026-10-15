-- Minutes of Meeting agent (email after transcript)
ALTER TABLE "contact_activities" ADD COLUMN IF NOT EXISTS "mom_sent_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "contact_activities_type_due_at_mom_sent_at_idx"
  ON "contact_activities"("type", "due_at", "mom_sent_at");
