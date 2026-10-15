-- Proposals (narrative packages) — separate from Quotes
CREATE TYPE "ProposalStatus" AS ENUM ('draft', 'shared', 'accepted', 'declined');

CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "deal_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ProposalStatus" NOT NULL DEFAULT 'draft',
    "attachment_url" TEXT,
    "shared_at" TIMESTAMP(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposals_organization_id_number_version_key" ON "proposals"("organization_id", "number", "version");
CREATE INDEX "proposals_organization_id_deal_id_idx" ON "proposals"("organization_id", "deal_id");
CREATE INDEX "proposals_organization_id_status_updated_at_idx" ON "proposals"("organization_id", "status", "updated_at");
CREATE INDEX "proposals_deal_id_idx" ON "proposals"("deal_id");

ALTER TABLE "proposals"
  ADD CONSTRAINT "proposals_deal_id_fkey"
  FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Optional link: quote created from a proposal
ALTER TABLE "quotes" ADD COLUMN "proposal_id" TEXT;

CREATE INDEX "quotes_proposal_id_idx" ON "quotes"("proposal_id");

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_proposal_id_fkey"
  FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
