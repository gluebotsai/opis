-- Visual master (page-clone) for learned proposal playbooks.
ALTER TABLE "crm"."proposal_playbooks"
  ADD COLUMN IF NOT EXISTS "blueprint" JSONB,
  ADD COLUMN IF NOT EXISTS "assets" JSONB;
