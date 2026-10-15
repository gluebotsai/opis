-- Store ESP domain id + DNS records returned by the provider (e.g. Resend).
ALTER TABLE "email_domains"
  ADD COLUMN IF NOT EXISTS "provider_domain_id" TEXT,
  ADD COLUMN IF NOT EXISTS "dns_records" JSONB;
