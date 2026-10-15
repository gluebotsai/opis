-- Company names must be unique per tenant, not globally. A global lower(name)
-- unique blocked post-meeting deal creation when the same account name already
-- existed in another organization (e.g. hexaware in org 1003 vs contact in 1000).
DROP INDEX IF EXISTS "crm"."companies_name_lower_uidx";
CREATE UNIQUE INDEX IF NOT EXISTS "companies_org_name_lower_uidx"
  ON "crm"."companies" ("organization_id", lower("name"));
