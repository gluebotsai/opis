CREATE TABLE IF NOT EXISTS "organization_api_keys" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'app_push',
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "organization_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_api_keys_key_hash_key"
  ON "organization_api_keys"("key_hash");

CREATE UNIQUE INDEX IF NOT EXISTS "organization_api_keys_organization_id_purpose_key"
  ON "organization_api_keys"("organization_id", "purpose");

CREATE INDEX IF NOT EXISTS "organization_api_keys_organization_id_idx"
  ON "organization_api_keys"("organization_id");
