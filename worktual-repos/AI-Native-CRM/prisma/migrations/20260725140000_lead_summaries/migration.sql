-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_summaries" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "contact_id" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "headline" TEXT,
    "intent" TEXT,
    "signature" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'heuristic',
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "lead_summaries_organization_id_contact_id_key" ON "lead_summaries"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_summaries_organization_id_updated_at_idx" ON "lead_summaries"("organization_id", "updated_at");
