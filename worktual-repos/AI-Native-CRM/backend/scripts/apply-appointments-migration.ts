/**
 * Apply crm.appointments DDL on remote when prisma migrate deploy is blocked.
 * Idempotent — safe to re-run.
 *
 * Usage: npx tsx backend/scripts/apply-appointments-migration.ts
 */
import { prisma } from "../src/dao/db/prisma.js";

async function enumExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
      SELECT 1 FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'crm' AND t.typname = $1
    ) AS exists`,
    name,
  );
  return Boolean(rows[0]?.exists);
}

async function tableExists(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'crm' AND table_name = 'appointments'
    ) AS exists`,
  );
  return Boolean(rows[0]?.exists);
}

async function main() {
  if (await tableExists()) {
    console.log("crm.appointments already exists — nothing to do.");
    return;
  }

  if (!(await enumExists("appointment_status"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TYPE "crm"."appointment_status" AS ENUM (
        'scheduled', 'canceled', 'completed', 'no_show'
      )
    `);
    console.log("created enum crm.appointment_status");
  }

  if (!(await enumExists("appointment_source"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TYPE "crm"."appointment_source" AS ENUM (
        'crm_ui', 'ccaas_webchat', 'demo_agent'
      )
    `);
    console.log("created enum crm.appointment_source");
  }

  await prisma.$executeRawUnsafe(`
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
    )
  `);
  console.log("created table crm.appointments");

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "appointments_activity_id_key"
    ON "crm"."appointments"("activity_id")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "appointments_organization_id_contact_id_status_starts_at_idx"
    ON "crm"."appointments"("organization_id", "contact_id", "status", "starts_at")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "appointments_host_user_id_starts_at_idx"
    ON "crm"."appointments"("host_user_id", "starts_at")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "appointments_one_live_scheduled_per_contact_idx"
    ON "crm"."appointments" ("organization_id", "contact_id")
    WHERE "status" = 'scheduled'
  `);

  console.log("indexes created");
  console.log("done — crm.appointments ready on remote");
}

main()
  .catch((err) => {
    console.error("apply appointments migration failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
