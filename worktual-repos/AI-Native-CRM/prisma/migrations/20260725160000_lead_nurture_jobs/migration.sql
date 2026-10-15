-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LeadNurtureStatus" AS ENUM (
    'pending',
    'analyzing',
    'sent',
    'waited',
    'skipped',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_nurture_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "contact_id" UUID NOT NULL,
    "status" "LeadNurtureStatus" NOT NULL DEFAULT 'pending',
    "decision" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "next_retry_at" TIMESTAMP(3),
    "last_error" TEXT,
    "result_summary" JSONB,
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "lead_nurture_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "lead_nurture_jobs_organization_id_contact_id_key"
  ON "lead_nurture_jobs"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_nurture_jobs_status_next_retry_at_idx"
  ON "lead_nurture_jobs"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_nurture_jobs_organization_id_status_updated_at_idx"
  ON "lead_nurture_jobs"("organization_id", "status", "updated_at");
