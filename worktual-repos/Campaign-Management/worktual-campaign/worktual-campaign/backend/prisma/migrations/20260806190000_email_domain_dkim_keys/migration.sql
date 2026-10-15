-- Platform DKIM keys for Mode B domain connect (public DNS + encrypted private).
ALTER TABLE "email_domains"
  ADD COLUMN IF NOT EXISTS "dkim_selector" TEXT,
  ADD COLUMN IF NOT EXISTS "dkim_public_key" TEXT,
  ADD COLUMN IF NOT EXISTS "dkim_private_key_encrypted" TEXT;
