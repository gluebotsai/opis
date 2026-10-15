-- Email threading + Gmail message identity on contact_activities (crm_qa)

CREATE TYPE "EmailDirection" AS ENUM ('outbound', 'inbound');

ALTER TABLE "contact_activities"
  ADD COLUMN "thread_id" TEXT,
  ADD COLUMN "gmail_message_id" TEXT,
  ADD COLUMN "gmail_thread_id" TEXT,
  ADD COLUMN "email_direction" "EmailDirection";

-- Existing rows: each activity is its own thread until replies link in
UPDATE "contact_activities"
SET "thread_id" = "id"
WHERE "thread_id" IS NULL;

CREATE UNIQUE INDEX "contact_activities_gmail_message_id_key"
  ON "contact_activities" ("gmail_message_id");

CREATE INDEX "contact_activities_thread_id_created_at_idx"
  ON "contact_activities" ("thread_id", "created_at");

CREATE INDEX "contact_activities_gmail_thread_id_idx"
  ON "contact_activities" ("gmail_thread_id");
