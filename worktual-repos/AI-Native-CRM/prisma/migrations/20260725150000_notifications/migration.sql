-- CreateTable
CREATE TABLE IF NOT EXISTS "notifications" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "recipient_user_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "contact_id" UUID,
    "metadata" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "notifications_recipient_user_id_created_at_idx"
  ON "notifications"("recipient_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "notifications_recipient_user_id_read_at_idx"
  ON "notifications"("recipient_user_id", "read_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "notifications_organization_id_created_at_idx"
  ON "notifications"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "notifications_contact_id_idx"
  ON "notifications"("contact_id");
