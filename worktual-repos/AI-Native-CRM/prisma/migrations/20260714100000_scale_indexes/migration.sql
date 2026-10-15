-- Production indexes for list/filter/sort at scale

CREATE INDEX IF NOT EXISTS "companies_name_idx" ON "companies"("name");
CREATE INDEX IF NOT EXISTS "companies_created_at_idx" ON "companies"("created_at");

CREATE INDEX IF NOT EXISTS "company_locations_company_id_type_idx" ON "company_locations"("company_id", "type");

CREATE INDEX IF NOT EXISTS "deals_stage_updated_at_idx" ON "deals"("stage", "updated_at");
CREATE INDEX IF NOT EXISTS "deals_updated_at_idx" ON "deals"("updated_at");
CREATE INDEX IF NOT EXISTS "deals_location_id_updated_at_idx" ON "deals"("location_id", "updated_at");

CREATE INDEX IF NOT EXISTS "deal_activities_deal_id_created_at_idx" ON "deal_activities"("deal_id", "created_at");
