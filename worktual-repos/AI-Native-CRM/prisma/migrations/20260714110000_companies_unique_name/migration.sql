-- Production: prevent duplicate accounts from concurrent contact sync
CREATE UNIQUE INDEX IF NOT EXISTS "companies_name_lower_uidx" ON "companies" (lower("name"));
