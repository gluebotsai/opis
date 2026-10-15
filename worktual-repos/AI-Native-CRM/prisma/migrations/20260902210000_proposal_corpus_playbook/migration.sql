-- Proposal pattern learning: corpus batches, items, pairs, jobs, playbooks.

DO $$ BEGIN
  CREATE TYPE "crm"."ProposalCorpusBatchStatus" AS ENUM (
    'uploading',
    'processing',
    'pending_review',
    'failed',
    'completed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "crm"."ProposalCorpusItemKind" AS ENUM (
    'requirement',
    'proposal'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "crm"."ProposalCorpusItemStatus" AS ENUM (
    'pending',
    'ingested',
    'structured',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "crm"."ProposalCorpusJobStatus" AS ENUM (
    'pending',
    'ingesting',
    'structuring',
    'pairing',
    'synthesizing',
    'pending_review',
    'failed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "crm"."ProposalPlaybookStatus" AS ENUM (
    'draft',
    'pending_review',
    'approved',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "crm"."proposal_corpus_batches" (
  "id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "created_by_user_id" BIGINT NOT NULL,
  "name" TEXT,
  "status" "crm"."ProposalCorpusBatchStatus" NOT NULL DEFAULT 'uploading',
  "last_error" TEXT,
  "result_summary" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "proposal_corpus_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "proposal_corpus_batches_org_status_updated_idx"
  ON "crm"."proposal_corpus_batches"("organization_id", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "proposal_corpus_batches_org_created_idx"
  ON "crm"."proposal_corpus_batches"("organization_id", "created_at");

CREATE TABLE IF NOT EXISTS "crm"."proposal_corpus_items" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "kind" "crm"."ProposalCorpusItemKind" NOT NULL,
  "storage_path" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mime" TEXT,
  "page_count" INTEGER,
  "sha256" TEXT,
  "extract_json" JSONB,
  "status" "crm"."ProposalCorpusItemStatus" NOT NULL DEFAULT 'pending',
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_corpus_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "proposal_corpus_items_batch_kind_idx"
  ON "crm"."proposal_corpus_items"("batch_id", "kind");

CREATE INDEX IF NOT EXISTS "proposal_corpus_items_org_batch_idx"
  ON "crm"."proposal_corpus_items"("organization_id", "batch_id");

CREATE TABLE IF NOT EXISTS "crm"."proposal_corpus_pairs" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "requirement_item_id" TEXT NOT NULL,
  "proposal_item_id" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "gaps_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_corpus_pairs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "proposal_corpus_pairs_batch_req_prop_key"
  ON "crm"."proposal_corpus_pairs"("batch_id", "requirement_item_id", "proposal_item_id");

CREATE INDEX IF NOT EXISTS "proposal_corpus_pairs_org_batch_idx"
  ON "crm"."proposal_corpus_pairs"("organization_id", "batch_id");

CREATE TABLE IF NOT EXISTS "crm"."proposal_corpus_jobs" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "status" "crm"."ProposalCorpusJobStatus" NOT NULL DEFAULT 'pending',
  "stage" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "last_error" TEXT,
  "result_summary" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "proposal_corpus_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "proposal_corpus_jobs_org_status_updated_idx"
  ON "crm"."proposal_corpus_jobs"("organization_id", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "proposal_corpus_jobs_batch_idx"
  ON "crm"."proposal_corpus_jobs"("batch_id");

CREATE TABLE IF NOT EXISTS "crm"."proposal_playbooks" (
  "id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "source_batch_id" TEXT,
  "name" TEXT NOT NULL,
  "tags_json" JSONB,
  "sections_json" JSONB NOT NULL,
  "status" "crm"."ProposalPlaybookStatus" NOT NULL DEFAULT 'draft',
  "approved_at" TIMESTAMP(3),
  "approved_by_user_id" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_playbooks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "proposal_playbooks_org_status_updated_idx"
  ON "crm"."proposal_playbooks"("organization_id", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "proposal_playbooks_source_batch_idx"
  ON "crm"."proposal_playbooks"("source_batch_id");

DO $$ BEGIN
  ALTER TABLE "crm"."proposal_corpus_items"
    ADD CONSTRAINT "proposal_corpus_items_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "crm"."proposal_corpus_batches"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm"."proposal_corpus_pairs"
    ADD CONSTRAINT "proposal_corpus_pairs_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "crm"."proposal_corpus_batches"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm"."proposal_corpus_pairs"
    ADD CONSTRAINT "proposal_corpus_pairs_requirement_item_id_fkey"
    FOREIGN KEY ("requirement_item_id") REFERENCES "crm"."proposal_corpus_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm"."proposal_corpus_pairs"
    ADD CONSTRAINT "proposal_corpus_pairs_proposal_item_id_fkey"
    FOREIGN KEY ("proposal_item_id") REFERENCES "crm"."proposal_corpus_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm"."proposal_corpus_jobs"
    ADD CONSTRAINT "proposal_corpus_jobs_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "crm"."proposal_corpus_batches"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm"."proposal_playbooks"
    ADD CONSTRAINT "proposal_playbooks_source_batch_id_fkey"
    FOREIGN KEY ("source_batch_id") REFERENCES "crm"."proposal_corpus_batches"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
