-- Inbox folders for contact activities (Sent / Draft / Trash / Inbox)

CREATE TYPE "InboxFolder" AS ENUM ('inbox', 'sent', 'draft', 'trash');

ALTER TABLE "contact_activities"
  ADD COLUMN "folder" "InboxFolder" NOT NULL DEFAULT 'inbox';

-- Backfill outbound emails into Sent
UPDATE "contact_activities"
SET "folder" = 'sent'
WHERE "type" = 'email'
  AND (
    "body" ILIKE '%Sent via Gmail%'
    OR "body" ILIKE '%Mailto fallback%'
  );

CREATE INDEX "contact_activities_folder_created_at_idx"
  ON "contact_activities" ("folder", "created_at");
