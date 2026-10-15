-- Lead Scoring Agent queue (one row per org + contact).

DO $$ BEGIN
  CREATE TYPE "LeadScoringStatus" AS ENUM (
    'pending',
    'scoring',
    'scored',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "lead_scoring_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "contact_id" UUID NOT NULL,
    "status" "LeadScoringStatus" NOT NULL DEFAULT 'pending',
    "score" INTEGER,
    "grade" TEXT,
    "band" TEXT,
    "rationale" TEXT,
    "factors" JSONB,
    "next_best_action" TEXT,
    "trigger_reason" TEXT,
    "previous_score" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "next_retry_at" TIMESTAMP(3),
    "last_error" TEXT,
    "result_summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "lead_scoring_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_scoring_jobs_organization_id_contact_id_key"
  ON "lead_scoring_jobs"("organization_id", "contact_id");

CREATE INDEX IF NOT EXISTS "lead_scoring_jobs_status_next_retry_at_idx"
  ON "lead_scoring_jobs"("status", "next_retry_at");

CREATE INDEX IF NOT EXISTS "lead_scoring_jobs_organization_id_status_updated_at_idx"
  ON "lead_scoring_jobs"("organization_id", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "lead_scoring_jobs_organization_id_grade_score_idx"
  ON "lead_scoring_jobs"("organization_id", "grade", "score");
