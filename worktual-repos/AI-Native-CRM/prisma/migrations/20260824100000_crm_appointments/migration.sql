-- CreateEnum
CREATE TYPE "crm"."appointment_status" AS ENUM ('scheduled', 'canceled', 'completed', 'no_show');

-- CreateEnum
CREATE TYPE "crm"."appointment_source" AS ENUM ('crm_ui', 'ccaas_webchat', 'demo_agent');

-- CreateTable
CREATE TABLE "crm"."appointments" (
    "id" TEXT NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "host_user_id" BIGINT NOT NULL,
    "activity_id" TEXT,
    "source" "crm"."appointment_source" NOT NULL,
    "status" "crm"."appointment_status" NOT NULL DEFAULT 'scheduled',
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "provider" "crm"."meeting_assist_provider" NOT NULL DEFAULT 'google_meet',
    "join_url" TEXT,
    "calendar_event_id" TEXT,
    "guest_emails" JSONB NOT NULL DEFAULT '[]',
    "assignment_reason" TEXT,
    "canceled_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointments_activity_id_key" ON "crm"."appointments"("activity_id");

-- CreateIndex
CREATE INDEX "appointments_organization_id_contact_id_status_starts_at_idx" ON "crm"."appointments"("organization_id", "contact_id", "status", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_host_user_id_starts_at_idx" ON "crm"."appointments"("host_user_id", "starts_at");

-- One live scheduled booking per contact (future enforcement also in API).
CREATE UNIQUE INDEX "appointments_one_live_scheduled_per_contact_idx"
ON "crm"."appointments" ("organization_id", "contact_id")
WHERE "status" = 'scheduled';
