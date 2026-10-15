-- Company logo URL filled by lead enrichment (fill-blanks only).
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "logo_url" TEXT;
