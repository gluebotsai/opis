-- CRM-only contact fields (moved off shared my_account_qa.public.contacts)

CREATE TABLE IF NOT EXISTS "contact_profiles" (
    "id" TEXT NOT NULL,
    "account_contact_id" UUID NOT NULL,
    "organization_id" UUID,
    "company_id" TEXT,
    "location_id" TEXT,
    "owner_user_id" UUID,
    "lifecycle_stage" VARCHAR(32) NOT NULL DEFAULT 'lead',
    "lead_source" VARCHAR(128),
    "lead_status" VARCHAR(32) NOT NULL DEFAULT 'new',
    "disqualify_reason" VARCHAR(64),
    "bant_budget" BOOLEAN,
    "bant_authority" BOOLEAN,
    "bant_need" BOOLEAN,
    "bant_timeline" BOOLEAN,
    "converted_deal_id" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "crm_status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_profiles_account_contact_id_key" ON "contact_profiles"("account_contact_id");
CREATE INDEX IF NOT EXISTS "contact_profiles_lifecycle_stage_idx" ON "contact_profiles"("lifecycle_stage");
CREATE INDEX IF NOT EXISTS "contact_profiles_lead_status_idx" ON "contact_profiles"("lead_status");
CREATE INDEX IF NOT EXISTS "contact_profiles_crm_status_idx" ON "contact_profiles"("crm_status");
CREATE INDEX IF NOT EXISTS "contact_profiles_company_id_idx" ON "contact_profiles"("company_id");
CREATE INDEX IF NOT EXISTS "contact_profiles_location_id_idx" ON "contact_profiles"("location_id");
CREATE INDEX IF NOT EXISTS "contact_profiles_owner_user_id_lead_status_idx" ON "contact_profiles"("owner_user_id", "lead_status");
CREATE INDEX IF NOT EXISTS "contact_profiles_lifecycle_stage_lead_status_idx" ON "contact_profiles"("lifecycle_stage", "lead_status");
CREATE INDEX IF NOT EXISTS "contact_profiles_is_pinned_updated_at_idx" ON "contact_profiles"("is_pinned", "updated_at");
CREATE INDEX IF NOT EXISTS "contact_profiles_organization_id_updated_at_idx" ON "contact_profiles"("organization_id", "updated_at");

ALTER TABLE "contact_profiles"
  ADD CONSTRAINT "contact_profiles_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contact_profiles"
  ADD CONSTRAINT "contact_profiles_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "company_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
