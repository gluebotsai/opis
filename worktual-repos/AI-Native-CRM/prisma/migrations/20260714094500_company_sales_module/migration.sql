-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('hq', 'branch');

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM (
  'lead',
  'qualification',
  'demo',
  'proposal_quote',
  'negotiation_review',
  'sales_order_commitment',
  'closed_won',
  'closed_lost'
);

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('call', 'meeting', 'email', 'note', 'task');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "employee_count" INTEGER,
    "owner_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_locations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL DEFAULT 'branch',
    "address" TEXT,
    "city" TEXT,
    "industry" TEXT,
    "employee_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" "DealStage" NOT NULL DEFAULT 'lead',
    "amount" DECIMAL(12,2),
    "company_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "contact_id" UUID,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "owner_user_id" UUID,
    "notes" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_activities" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_locations_company_id_idx" ON "company_locations"("company_id");

-- CreateIndex
CREATE INDEX "deals_company_id_idx" ON "deals"("company_id");

-- CreateIndex
CREATE INDEX "deals_location_id_idx" ON "deals"("location_id");

-- CreateIndex
CREATE INDEX "deals_stage_idx" ON "deals"("stage");

-- CreateIndex
CREATE INDEX "deal_activities_deal_id_idx" ON "deal_activities"("deal_id");

-- AddForeignKey
ALTER TABLE "company_locations" ADD CONSTRAINT "company_locations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "company_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_activities" ADD CONSTRAINT "deal_activities_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
