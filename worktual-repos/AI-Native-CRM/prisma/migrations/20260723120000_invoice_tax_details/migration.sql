-- Persist country-specific tax breakdown on invoices (GST / VAT / sales tax).
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "tax_details" JSONB;
