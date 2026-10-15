-- CreateEnum
CREATE TYPE "QuoteTemplateKind" AS ENUM ('standard');

-- CreateTable
CREATE TABLE "quote_templates" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "kind" "QuoteTemplateKind" NOT NULL DEFAULT 'standard',
    "sections" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_templates_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN "template_id" TEXT,
ADD COLUMN "document_sections" JSONB,
ADD COLUMN "customer_name" TEXT,
ADD COLUMN "company_name" TEXT,
ADD COLUMN "vendor_name" TEXT;

-- CreateIndex
CREATE INDEX "quote_templates_organization_id_idx" ON "quote_templates"("organization_id");

-- CreateIndex
CREATE INDEX "quote_templates_organization_id_is_default_idx" ON "quote_templates"("organization_id", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "quote_templates_organization_id_code_key" ON "quote_templates"("organization_id", "code");

-- CreateIndex
CREATE INDEX "quotes_template_id_idx" ON "quotes"("template_id");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "quote_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
