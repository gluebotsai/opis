-- Auto-reply agent: provider-agnostic mail ids + manual response flag + job table.

DO $$ BEGIN
  CREATE TYPE "EmailAutoReplyStatus" AS ENUM ('pending', 'analyzing', 'replied', 'escalated', 'skipped', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MailProvider" AS ENUM ('google', 'microsoft');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "contact_activities"
  ADD COLUMN IF NOT EXISTS "provider_message_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_thread_id" TEXT,
  ADD COLUMN IF NOT EXISTS "mail_provider" "MailProvider",
  ADD COLUMN IF NOT EXISTS "needs_manual_response" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "contact_activities_provider_message_id_key"
  ON "contact_activities" ("provider_message_id");

CREATE INDEX IF NOT EXISTS "contact_activities_provider_thread_id_idx"
  ON "contact_activities" ("provider_thread_id");

-- Backfill existing Gmail rows into the provider-agnostic columns.
UPDATE "contact_activities"
SET "provider_message_id" = "gmail_message_id",
    "provider_thread_id" = COALESCE("provider_thread_id", "gmail_thread_id"),
    "mail_provider" = 'google'
WHERE "gmail_message_id" IS NOT NULL
  AND "provider_message_id" IS NULL;

CREATE TABLE IF NOT EXISTS "email_auto_reply_jobs" (
  "id" TEXT NOT NULL,
  "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  "contact_id" UUID NOT NULL,
  "inbound_activity_id" TEXT NOT NULL,
  "mailbox_user_id" UUID,
  "status" "EmailAutoReplyStatus" NOT NULL DEFAULT 'pending',
  "decision" TEXT,
  "sensitivity" TEXT,
  "category" TEXT,
  "reason" TEXT,
  "reply_activity_id" TEXT,
  "escalated_to_user_id" UUID,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "next_retry_at" TIMESTAMP(3),
  "last_error" TEXT,
  "result_summary" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "email_auto_reply_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_auto_reply_jobs_inbound_activity_id_key"
  ON "email_auto_reply_jobs" ("inbound_activity_id");

CREATE INDEX IF NOT EXISTS "email_auto_reply_jobs_status_next_retry_at_idx"
  ON "email_auto_reply_jobs" ("status", "next_retry_at");

CREATE INDEX IF NOT EXISTS "email_auto_reply_jobs_org_status_completed_idx"
  ON "email_auto_reply_jobs" ("organization_id", "status", "completed_at");
