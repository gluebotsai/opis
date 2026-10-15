-- CreateEnum
CREATE TYPE "ProductBillingType" AS ENUM ('one_time', 'recurring');

-- CreateEnum
CREATE TYPE "ProductBillingFrequency" AS ENUM ('monthly', 'quarterly', 'annual');

-- CreateEnum
CREATE TYPE "ProductUnitOfMeasure" AS ENUM ('per_seat', 'per_agent', 'per_ticket', 'flat');

-- AlterTable
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "billing_type" "ProductBillingType" NOT NULL DEFAULT 'one_time',
  ADD COLUMN IF NOT EXISTS "billing_frequency" "ProductBillingFrequency",
  ADD COLUMN IF NOT EXISTS "unit_of_measure" "ProductUnitOfMeasure" NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS "pricing_tiers" JSONB;
