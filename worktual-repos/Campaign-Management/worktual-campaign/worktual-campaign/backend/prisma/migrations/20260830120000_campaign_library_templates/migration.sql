-- Marketing template library (system seeds + user uploads), per organization

CREATE TABLE "campaign_library_templates" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "seed_slug" TEXT,
    "seed_catalog" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "style_notes" TEXT NOT NULL DEFAULT '',
    "goal" TEXT NOT NULL DEFAULT '',
    "primary_channel" TEXT NOT NULL,
    "channels" JSONB NOT NULL DEFAULT '[]',
    "audience" TEXT NOT NULL DEFAULT '',
    "flow_steps" JSONB NOT NULL DEFAULT '[]',
    "starter_message" TEXT NOT NULL DEFAULT '',
    "approval_status" TEXT NOT NULL DEFAULT 'approved',
    "body_preview" TEXT NOT NULL DEFAULT '',
    "content_body" TEXT NOT NULL DEFAULT '',
    "preview_image" TEXT,
    "preview" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "external_template_id" TEXT NOT NULL DEFAULT '',
    "created_by_user_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_library_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_library_templates_organization_id_seed_slug_key"
  ON "campaign_library_templates"("organization_id", "seed_slug");

CREATE INDEX "campaign_library_templates_organization_id_primary_channel_idx"
  ON "campaign_library_templates"("organization_id", "primary_channel");

CREATE INDEX "campaign_library_templates_organization_id_source_idx"
  ON "campaign_library_templates"("organization_id", "source");
