-- CreateTable
CREATE TABLE IF NOT EXISTS "app_notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "source_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "app_notifications_tenant_id_source_key_key"
  ON "app_notifications"("tenant_id", "source_key");

CREATE INDEX IF NOT EXISTS "app_notifications_tenant_id_user_id_created_at_idx"
  ON "app_notifications"("tenant_id", "user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "app_notifications_tenant_id_created_at_idx"
  ON "app_notifications"("tenant_id", "created_at" DESC);
