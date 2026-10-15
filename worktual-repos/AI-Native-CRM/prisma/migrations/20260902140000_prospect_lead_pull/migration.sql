-- Chat-driven multi-source prospect lead pull (Apollo / ZoomInfo / Lusha / BuiltWith).
-- Tables live in crm schema (Prisma @@schema("crm")).

DO $$ BEGIN
  CREATE TYPE "crm"."ProspectPullStatus" AS ENUM (
    'pending',
    'searching',
    'qualifying',
    'personnel',
    'ready_for_review',
    'importing',
    'imported',
    'failed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "crm"."ResearchProvider" AS ENUM (
    'apollo',
    'zoominfo',
    'lusha',
    'builtwith'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "crm"."org_research_provider_configs" (
  "id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "provider" "crm"."ResearchProvider" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "api_key_enc" TEXT,
  "api_key_hint" TEXT,
  "settings" JSONB,
  "updated_by_user_id" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "org_research_provider_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_research_provider_configs_org_provider_key"
  ON "crm"."org_research_provider_configs"("organization_id", "provider");

CREATE INDEX IF NOT EXISTS "org_research_provider_configs_org_idx"
  ON "crm"."org_research_provider_configs"("organization_id");

CREATE TABLE IF NOT EXISTS "crm"."prospect_pull_jobs" (
  "id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "requested_by_user_id" BIGINT NOT NULL,
  "status" "crm"."ProspectPullStatus" NOT NULL DEFAULT 'pending',
  "limit_n" INTEGER NOT NULL DEFAULT 10,
  "sources_requested" JSONB NOT NULL DEFAULT '[]',
  "sources_used" JSONB,
  "criteria" JSONB NOT NULL DEFAULT '{}',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "last_error" TEXT,
  "result_summary" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "prospect_pull_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "prospect_pull_jobs_org_status_updated_idx"
  ON "crm"."prospect_pull_jobs"("organization_id", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "prospect_pull_jobs_org_created_idx"
  ON "crm"."prospect_pull_jobs"("organization_id", "created_at");

CREATE TABLE IF NOT EXISTS "crm"."prospect_pull_candidates" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "rank" INTEGER,
  "selected" BOOLEAN NOT NULL DEFAULT true,
  "first_name" TEXT,
  "last_name" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "title" TEXT,
  "company_name" TEXT,
  "company_domain" TEXT,
  "linkedin_url" TEXT,
  "industry" TEXT,
  "employee_count" INTEGER,
  "city" TEXT,
  "country" TEXT,
  "technographics" JSONB,
  "sources_found_in" JSONB NOT NULL DEFAULT '[]',
  "qualify_reasons" JSONB,
  "qualify_score" INTEGER,
  "provider_payload" JSONB,
  "imported_contact_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prospect_pull_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prospect_pull_candidates_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "crm"."prospect_pull_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "prospect_pull_candidates_job_rank_idx"
  ON "crm"."prospect_pull_candidates"("job_id", "rank");

CREATE INDEX IF NOT EXISTS "prospect_pull_candidates_org_job_idx"
  ON "crm"."prospect_pull_candidates"("organization_id", "job_id");

CREATE TABLE IF NOT EXISTS "crm"."prospect_provider_cache" (
  "id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "provider" "crm"."ResearchProvider" NOT NULL,
  "query_hash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prospect_provider_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "prospect_provider_cache_org_provider_hash_key"
  ON "crm"."prospect_provider_cache"("organization_id", "provider", "query_hash");

CREATE INDEX IF NOT EXISTS "prospect_provider_cache_expires_idx"
  ON "crm"."prospect_provider_cache"("expires_at");
