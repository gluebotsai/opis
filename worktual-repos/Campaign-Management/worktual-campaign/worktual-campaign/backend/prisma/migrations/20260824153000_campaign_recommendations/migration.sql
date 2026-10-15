-- Tenant-shared recommendation idea cards (not launched campaigns).
CREATE TABLE "campaign_recommendations" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "branch_id" BIGINT NOT NULL,
    "created_by_user_id" BIGINT NOT NULL,
    "public_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_recommendations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_recommendations_tenant_id_public_id_key"
  ON "campaign_recommendations"("tenant_id", "public_id");

CREATE INDEX "campaign_recommendations_tenant_id_status_updated_at_idx"
  ON "campaign_recommendations"("tenant_id", "status", "updated_at" DESC);
