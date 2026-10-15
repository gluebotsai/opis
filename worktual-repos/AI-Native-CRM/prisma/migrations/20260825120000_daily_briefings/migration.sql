-- Daily voice briefing: one spoken script per org user per IST calendar day.

CREATE TABLE IF NOT EXISTS "crm"."daily_briefings" (
  "id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "user_id" BIGINT NOT NULL,
  "briefing_date" DATE NOT NULL,
  "script" TEXT NOT NULL,
  "items" JSONB NOT NULL DEFAULT '[]',
  "played_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "daily_briefings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_briefings_organization_id_user_id_briefing_date_key"
  ON "crm"."daily_briefings"("organization_id", "user_id", "briefing_date");

CREATE INDEX IF NOT EXISTS "daily_briefings_organization_id_user_id_idx"
  ON "crm"."daily_briefings"("organization_id", "user_id");
