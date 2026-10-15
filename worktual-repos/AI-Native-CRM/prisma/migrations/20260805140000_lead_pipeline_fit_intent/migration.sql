-- Lead pipeline Phase 1: Fit/Intent scores, enrichment cache, assignment SLA, nurture status

ALTER TABLE "lead_scoring_jobs"
  ADD COLUMN IF NOT EXISTS "fit_score" INTEGER,
  ADD COLUMN IF NOT EXISTS "intent_score" INTEGER;

ALTER TABLE "lead_summaries"
  ADD COLUMN IF NOT EXISTS "recommended_action" TEXT,
  ADD COLUMN IF NOT EXISTS "flags" JSONB;

ALTER TABLE "contact_profiles"
  ADD COLUMN IF NOT EXISTS "assignment_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "sla_deadline" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "assigned_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "assignment_escalated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "nurture_status" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "nurture_sequence_step" INTEGER,
  ADD COLUMN IF NOT EXISTS "nurture_started_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nurture_last_touch_at" TIMESTAMP(3);

ALTER TABLE "lead_nurture_jobs"
  ADD COLUMN IF NOT EXISTS "nurture_status" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "current_sequence_step" INTEGER,
  ADD COLUMN IF NOT EXISTS "sequence_started_at" TIMESTAMP(3);

ALTER TABLE "org_assignment_settings"
  ADD COLUMN IF NOT EXISTS "lead_icp" JSONB;

CREATE TABLE IF NOT EXISTS "domain_enrichment_cache" (
  "id" TEXT NOT NULL,
  "organization_id" UUID NOT NULL,
  "domain" VARCHAR(255) NOT NULL,
  "payload" JSONB NOT NULL,
  "source" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_enrichment_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "domain_enrichment_cache_org_domain_key"
  ON "domain_enrichment_cache"("organization_id", "domain");

CREATE INDEX IF NOT EXISTS "domain_enrichment_cache_expires_at_idx"
  ON "domain_enrichment_cache"("expires_at");

CREATE TABLE IF NOT EXISTS "lead_enrichment_snapshots" (
  "id" TEXT NOT NULL,
  "organization_id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  "company_name" TEXT,
  "company_size" TEXT,
  "industry" TEXT,
  "revenue_band" TEXT,
  "seniority_tier" VARCHAR(32),
  "geography" TEXT,
  "email_domain_type" VARCHAR(16),
  "enrichment_confidence" DOUBLE PRECISION,
  "enrichment_source" TEXT,
  "conflict_flags" JSONB,
  "enrichment_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_enrichment_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_enrichment_snapshots_org_contact_key"
  ON "lead_enrichment_snapshots"("organization_id", "contact_id");

CREATE INDEX IF NOT EXISTS "lead_enrichment_snapshots_org_updated_idx"
  ON "lead_enrichment_snapshots"("organization_id", "updated_at");
