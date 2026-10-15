-- Active From sender for campaign email sends (one per tenant)

ALTER TABLE "email_senders"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "email_senders_tenant_id_is_active_idx"
  ON "email_senders"("tenant_id", "is_active");

-- Prefer the most recently verified sender as active when none is set.
UPDATE "email_senders" AS s
SET "is_active" = true
FROM (
  SELECT DISTINCT ON ("tenant_id") "id", "tenant_id"
  FROM "email_senders"
  WHERE "status" = 'verified'
  ORDER BY "tenant_id", "verified_at" DESC NULLS LAST, "created_at" DESC
) AS pick
WHERE s."id" = pick."id"
  AND NOT EXISTS (
    SELECT 1
    FROM "email_senders" o
    WHERE o."tenant_id" = s."tenant_id"
      AND o."is_active" = true
  );
