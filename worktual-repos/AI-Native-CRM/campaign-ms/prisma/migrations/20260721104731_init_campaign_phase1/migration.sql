-- CreateEnum
CREATE TYPE "ProductCode" AS ENUM ('campaign', 'crm');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'scheduled', 'live', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "SourceChannel" AS ENUM ('standalone_campaign', 'crm_marketing');

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_code" "ProductCode" NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'active',
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "source_channel" "SourceChannel" NOT NULL DEFAULT 'standalone_campaign',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branches_tenant_id_idx" ON "branches"("tenant_id");

-- CreateIndex
CREATE INDEX "branches_tenant_id_is_default_idx" ON "branches"("tenant_id", "is_default");

-- CreateIndex
CREATE INDEX "organization_products_tenant_id_branch_id_idx" ON "organization_products"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "organization_products_tenant_id_product_code_status_idx" ON "organization_products"("tenant_id", "product_code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_products_tenant_id_branch_id_product_code_key" ON "organization_products"("tenant_id", "branch_id", "product_code");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_branch_id_idx" ON "campaigns"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_branch_id_status_idx" ON "campaigns"("tenant_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_branch_id_starts_at_idx" ON "campaigns"("tenant_id", "branch_id", "starts_at");

-- AddForeignKey
ALTER TABLE "organization_products" ADD CONSTRAINT "organization_products_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
