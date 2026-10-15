-- Additive V2 generate jobs (crm schema). Existing proposals/playbooks unchanged.

CREATE TABLE IF NOT EXISTS "proposal_generation_runs" (
    "id" TEXT NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "replaces_proposal_id" TEXT,
    "base_proposal_updated_at" TIMESTAMP(3),
    "pipeline_version" INTEGER NOT NULL DEFAULT 2,
    "proposal_id" TEXT,
    "actor_user_id" TEXT,
    "status" VARCHAR(32) NOT NULL DEFAULT 'queued',
    "input_hash" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL DEFAULT 'v2',
    "playbook_id" TEXT,
    "content_playbook_id" TEXT,
    "requirement_text" TEXT NOT NULL DEFAULT '',
    "input_json" JSONB,
    "requirement_profile" JSONB,
    "kb_snapshot" JSONB,
    "catalog_snapshot" JSONB,
    "deal_plan" JSONB,
    "outline" JSONB,
    "pricing_snapshot" JSONB,
    "pricing_issues" JSONB,
    "deal_brief" JSONB,
    "qa_report" JSONB,
    "error" JSONB,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "cost_estimate" DECIMAL(10,4),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "next_retry_at" TIMESTAMP(3),
    "max_tokens" INTEGER,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_generation_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "proposal_generation_runs_proposal_id_key"
  ON "proposal_generation_runs"("proposal_id");
CREATE INDEX IF NOT EXISTS "proposal_generation_runs_organization_id_status_idx"
  ON "proposal_generation_runs"("organization_id", "status");
CREATE INDEX IF NOT EXISTS "proposal_generation_runs_organization_id_input_hash_idx"
  ON "proposal_generation_runs"("organization_id", "input_hash");
CREATE INDEX IF NOT EXISTS "proposal_generation_runs_deal_id_status_idx"
  ON "proposal_generation_runs"("deal_id", "status");
CREATE INDEX IF NOT EXISTS "proposal_generation_runs_status_heartbeat_at_idx"
  ON "proposal_generation_runs"("status", "heartbeat_at");
CREATE INDEX IF NOT EXISTS "proposal_generation_runs_status_next_retry_at_idx"
  ON "proposal_generation_runs"("status", "next_retry_at");

DO $$ BEGIN
  ALTER TABLE "proposal_generation_runs"
    ADD CONSTRAINT "proposal_generation_runs_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "proposal_generation_leaves" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "leaf_key" TEXT NOT NULL,
    "section_type" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "wave" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_class" TEXT,
    "next_retry_at" TIMESTAMP(3),
    "output_json" JSONB,
    "model_used" TEXT,
    "latency_ms" INTEGER,
    "tokens_in" INTEGER,
    "tokens_out" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_generation_leaves_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "proposal_generation_leaves_run_id_leaf_key_key"
  ON "proposal_generation_leaves"("run_id", "leaf_key");
CREATE INDEX IF NOT EXISTS "proposal_generation_leaves_run_id_status_idx"
  ON "proposal_generation_leaves"("run_id", "status");
CREATE INDEX IF NOT EXISTS "proposal_generation_leaves_status_next_retry_at_idx"
  ON "proposal_generation_leaves"("status", "next_retry_at");

DO $$ BEGIN
  ALTER TABLE "proposal_generation_leaves"
    ADD CONSTRAINT "proposal_generation_leaves_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "proposal_generation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "proposal_playbooks"
  ADD COLUMN IF NOT EXISTS "section_library_json" JSONB;
