-- Automatic Template Gallery: ideas + bootstrap jobs; retire static library seeds visibility

CREATE TABLE "campaign_gallery_ideas" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "idea_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "industry" TEXT NOT NULL DEFAULT '',
    "industry_type" TEXT NOT NULL DEFAULT '',
    "pack_id" TEXT NOT NULL DEFAULT 'generic-b2b',
    "image_url" TEXT,
    "image_meta" JSONB NOT NULL DEFAULT '{}',
    "generation_version" TEXT NOT NULL DEFAULT 'gallery-v1',
    "status" TEXT NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_gallery_ideas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_gallery_ideas_organization_id_idea_key_key"
ON "campaign_gallery_ideas"("organization_id", "idea_key");

CREATE INDEX "campaign_gallery_ideas_organization_id_status_sort_order_idx"
ON "campaign_gallery_ideas"("organization_id", "status", "sort_order");

CREATE TABLE "campaign_gallery_jobs" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "job_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "channels_snapshot" JSONB NOT NULL DEFAULT '[]',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_gallery_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "campaign_gallery_jobs_organization_id_status_idx"
ON "campaign_gallery_jobs"("organization_id", "status");

-- Hide legacy static system seeds (keep rows for audit; gallery UI excludes them)
UPDATE "campaign_library_templates"
SET "metadata" = COALESCE("metadata", '{}'::jsonb) || '{"galleryStatus":"hidden","legacyStaticSeed":true}'::jsonb
WHERE "source" = 'system';
