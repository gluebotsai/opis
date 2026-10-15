-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LeadLifecycleStatus" AS ENUM (
    'pending',
    'analyzing',
    'applied',
    'waited',
    'skipped',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_lifecycle_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "contact_id" UUID NOT NULL,
    "status" "LeadLifecycleStatus" NOT NULL DEFAULT 'pending',
    "ladder" TEXT,
    "from_stage" TEXT,
    "to_stage" TEXT,
    "decision" TEXT,
    "reason" TEXT,
    "trigger_reason" TEXT,
    "deal_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "next_retry_at" TIMESTAMP(3),
    "last_error" TEXT,
    "result_summary" JSONB,
    "last_applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "lead_lifecycle_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "lead_lifecycle_jobs_organization_id_contact_id_key"
  ON "lead_lifecycle_jobs"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_lifecycle_jobs_status_next_retry_at_idx"
  ON "lead_lifecycle_jobs"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_lifecycle_jobs_organization_id_status_updated_at_idx"
  ON "lead_lifecycle_jobs"("organization_id", "status", "updated_at");

-- Transcript capture on activities (provider ingest lands later; body is the
-- Phase A proxy). Columns are additive and nullable.
ALTER TABLE "contact_activities"
  ADD COLUMN IF NOT EXISTS "transcript_text" TEXT,
  ADD COLUMN IF NOT EXISTS "transcript_source" TEXT,
  ADD COLUMN IF NOT EXISTS "transcript_analyzed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "transcript_insights" JSONB;
