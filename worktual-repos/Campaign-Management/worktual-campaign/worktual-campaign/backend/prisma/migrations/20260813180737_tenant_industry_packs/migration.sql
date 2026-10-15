-- Per-company industry packs (seed from industry_type; grow with rules/fields)
CREATE TABLE "tenant_industry_packs" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "pack_id" TEXT NOT NULL DEFAULT 'generic-b2b',
    "seed_industry_type" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_industry_packs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_industry_packs_tenant_id_key" ON "tenant_industry_packs"("tenant_id");
