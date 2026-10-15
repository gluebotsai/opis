-- Visual HTML blueprints + inline assets for proposal/quote templates and documents.

ALTER TABLE "proposal_templates"
  ADD COLUMN IF NOT EXISTS "blueprint" JSONB,
  ADD COLUMN IF NOT EXISTS "assets" JSONB;

ALTER TABLE "quote_templates"
  ADD COLUMN IF NOT EXISTS "blueprint" JSONB,
  ADD COLUMN IF NOT EXISTS "assets" JSONB;

ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "blueprint" JSONB,
  ADD COLUMN IF NOT EXISTS "assets" JSONB;

ALTER TABLE "quotes"
  ADD COLUMN IF NOT EXISTS "blueprint" JSONB,
  ADD COLUMN IF NOT EXISTS "assets" JSONB;
