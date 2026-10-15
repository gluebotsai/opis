-- Contact activity timeline + sms activity type (crm_qa)

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'sms';

CREATE TABLE IF NOT EXISTS "contact_activities" (
    "id" TEXT NOT NULL,
    "contact_id" UUID NOT NULL,
    "type" "ActivityType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "contact_activities_contact_id_idx"
  ON "contact_activities"("contact_id");

CREATE INDEX IF NOT EXISTS "contact_activities_contact_id_created_at_idx"
  ON "contact_activities"("contact_id", "created_at");
