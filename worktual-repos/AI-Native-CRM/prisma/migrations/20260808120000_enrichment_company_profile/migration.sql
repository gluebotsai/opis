-- Store what the company does + named products on the CRM enrichment snapshot.
ALTER TABLE "lead_enrichment_snapshots"
  ADD COLUMN IF NOT EXISTS "company_description" TEXT,
  ADD COLUMN IF NOT EXISTS "products" TEXT;
