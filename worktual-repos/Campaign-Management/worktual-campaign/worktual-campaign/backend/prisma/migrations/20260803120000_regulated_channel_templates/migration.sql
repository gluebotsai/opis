-- Regulated SMS / WhatsApp approval templates (campaign schema)
CREATE TYPE "RegulatedTemplateStatus" AS ENUM (
  'draft',
  'pending',
  'approved',
  'rejected',
  'paused',
  'disabled'
);

CREATE TABLE "regulated_channel_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "channel" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "external_id" TEXT NOT NULL DEFAULT '',
  "provider_template_id" TEXT,
  "language" TEXT NOT NULL DEFAULT 'en',
  "category" TEXT NOT NULL DEFAULT '',
  "header" TEXT NOT NULL DEFAULT '',
  "body" TEXT NOT NULL,
  "footer" TEXT NOT NULL DEFAULT '',
  "buttons" TEXT NOT NULL DEFAULT '',
  "status" "RegulatedTemplateStatus" NOT NULL DEFAULT 'draft',
  "rejected_reason" TEXT,
  "channel_config_id" UUID,
  "submitted_at" TIMESTAMP(3),
  "last_status_checked_at" TIMESTAMP(3),
  "created_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "regulated_channel_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "regulated_channel_templates_tenant_id_channel_status_idx"
  ON "regulated_channel_templates"("tenant_id", "channel", "status");

CREATE INDEX "regulated_channel_templates_tenant_id_channel_name_idx"
  ON "regulated_channel_templates"("tenant_id", "channel", "name");
