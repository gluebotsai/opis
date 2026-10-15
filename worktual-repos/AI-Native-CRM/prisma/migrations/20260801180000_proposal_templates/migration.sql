-- Standard proposal templates + structured customer proposal bodies
CREATE TYPE "ProposalTemplateKind" AS ENUM ('standard');

CREATE TABLE "proposal_templates" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "kind" "ProposalTemplateKind" NOT NULL DEFAULT 'standard',
    "sections" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposal_templates_organization_id_code_key" ON "proposal_templates"("organization_id", "code");
CREATE INDEX "proposal_templates_organization_id_idx" ON "proposal_templates"("organization_id");
CREATE INDEX "proposal_templates_organization_id_is_default_idx" ON "proposal_templates"("organization_id", "is_default");

ALTER TABLE "proposals" ADD COLUMN "template_id" TEXT;
ALTER TABLE "proposals" ADD COLUMN "sections" JSONB;
ALTER TABLE "proposals" ADD COLUMN "customer_name" TEXT;

CREATE INDEX "proposals_template_id_idx" ON "proposals"("template_id");

ALTER TABLE "proposals" ADD CONSTRAINT "proposals_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "proposal_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
