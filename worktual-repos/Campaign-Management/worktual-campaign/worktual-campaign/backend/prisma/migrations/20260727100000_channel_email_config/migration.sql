-- Permanent channel / email sending configuration

CREATE TYPE "ChannelConfigStatus" AS ENUM ('not_started', 'in_progress', 'ready', 'blocked');

CREATE TABLE "channel_sending_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "status" "ChannelConfigStatus" NOT NULL DEFAULT 'not_started',
    "checklist" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_sending_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_sending_profiles_tenant_id_channel_key"
  ON "channel_sending_profiles"("tenant_id", "channel");
CREATE INDEX "channel_sending_profiles_tenant_id_idx"
  ON "channel_sending_profiles"("tenant_id");

CREATE TABLE "email_org_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_org_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_org_profiles_tenant_id_key" ON "email_org_profiles"("tenant_id");

CREATE TABLE "email_senders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "reply_to" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_verification',
    "verify_token" TEXT,
    "verify_expires_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_senders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_senders_tenant_id_from_email_key"
  ON "email_senders"("tenant_id", "from_email");
CREATE INDEX "email_senders_tenant_id_idx" ON "email_senders"("tenant_id");

CREATE TABLE "email_domains" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "spf_ok" BOOLEAN NOT NULL DEFAULT false,
    "dkim_ok" BOOLEAN NOT NULL DEFAULT false,
    "dmarc_ok" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_domains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_domains_tenant_id_domain_key"
  ON "email_domains"("tenant_id", "domain");
CREATE INDEX "email_domains_tenant_id_idx" ON "email_domains"("tenant_id");

CREATE TABLE "email_return_paths" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_return_paths_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_return_paths_tenant_id_key" ON "email_return_paths"("tenant_id");

CREATE TABLE "email_sending_caps" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "batch_size" INTEGER NOT NULL DEFAULT 200,
    "hourly_cap" INTEGER NOT NULL DEFAULT 500,
    "daily_cap" INTEGER NOT NULL DEFAULT 1000,
    "warmup_stage" INTEGER NOT NULL DEFAULT 0,
    "health_status" TEXT NOT NULL DEFAULT 'healthy',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_sending_caps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_sending_caps_tenant_id_key" ON "email_sending_caps"("tenant_id");
