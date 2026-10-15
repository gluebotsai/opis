-- CRM-owned OAuth connections (Email + Calendar). crm_qa only.

CREATE TYPE "IntegrationProvider" AS ENUM ('google', 'microsoft', 'zoom');

CREATE TABLE "user_integration_connections" (
  "id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "account_email" TEXT,
  "access_token" TEXT NOT NULL,
  "refresh_token" TEXT,
  "token_expires_at" TIMESTAMP(3),
  "scope" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_integration_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_integration_connections_user_id_provider_key"
  ON "user_integration_connections" ("user_id", "provider");

CREATE INDEX "user_integration_connections_user_id_idx"
  ON "user_integration_connections" ("user_id");
