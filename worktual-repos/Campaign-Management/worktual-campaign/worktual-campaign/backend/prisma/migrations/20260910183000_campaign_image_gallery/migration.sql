-- Reusable org image assets for Template module Image Gallery (forward-only catalog).

CREATE TABLE "campaign_image_gallery_assets" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "media_id" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "short_description" TEXT NOT NULL DEFAULT '',
    "generation_prompt" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'uploaded',
    "channel" TEXT NOT NULL DEFAULT '',
    "context" JSONB NOT NULL DEFAULT '{}',
    "reuse_tags" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by_user_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_image_gallery_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_image_gallery_assets_organization_id_media_id_key"
ON "campaign_image_gallery_assets"("organization_id", "media_id");

CREATE INDEX "campaign_image_gallery_assets_organization_id_status_created_at_idx"
ON "campaign_image_gallery_assets"("organization_id", "status", "created_at" DESC);
