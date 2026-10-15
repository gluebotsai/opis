-- CreateEnum
CREATE TYPE "InvoiceTemplateKind" AS ENUM ('standard');

-- CreateTable
CREATE TABLE "invoice_templates" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "kind" "InvoiceTemplateKind" NOT NULL DEFAULT 'standard',
    "sections" JSONB NOT NULL,
    "blueprint" JSONB,
    "assets" JSONB,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_templates_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "template_id" TEXT,
ADD COLUMN "sections" JSONB,
ADD COLUMN "blueprint" JSONB,
ADD COLUMN "assets" JSONB;

-- CreateIndex
CREATE INDEX "invoice_templates_organization_id_idx" ON "invoice_templates"("organization_id");

-- CreateIndex
CREATE INDEX "invoice_templates_organization_id_is_default_idx" ON "invoice_templates"("organization_id", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_templates_organization_id_code_key" ON "invoice_templates"("organization_id", "code");

-- CreateIndex
CREATE INDEX "invoices_template_id_idx" ON "invoices"("template_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "invoice_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
