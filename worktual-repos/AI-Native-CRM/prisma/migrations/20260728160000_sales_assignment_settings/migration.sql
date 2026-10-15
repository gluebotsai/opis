-- Durable sales assignment configuration (per-org threshold + per-rep capacity)

CREATE TYPE "SalesSeniorityTier" AS ENUM ('junior', 'mid', 'senior');

CREATE TABLE "org_assignment_settings" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "senior_amount_threshold" INTEGER NOT NULL DEFAULT 50000,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_assignment_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "org_assignment_settings_organization_id_key" ON "org_assignment_settings"("organization_id");

CREATE TABLE "sales_user_assignment_profiles" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "accepting_leads" BOOLEAN NOT NULL DEFAULT true,
    "max_open_deals" INTEGER,
    "seniority_tier" "SalesSeniorityTier",
    "on_pto_until" DATE,
    "country" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_user_assignment_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_user_assignment_profiles_organization_id_user_id_key" ON "sales_user_assignment_profiles"("organization_id", "user_id");
CREATE INDEX "sales_user_assignment_profiles_organization_id_idx" ON "sales_user_assignment_profiles"("organization_id");
CREATE INDEX "sales_user_assignment_profiles_user_id_idx" ON "sales_user_assignment_profiles"("user_id");
