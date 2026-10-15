-- CRM-owned A2A spoke task receipts (Hub task protocol). crm schema only.

CREATE TABLE IF NOT EXISTS "crm"."a2a_spoke_tasks" (
  "id" TEXT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "task_id" TEXT NOT NULL,
  "context_id" TEXT NOT NULL DEFAULT '',
  "skill_id" TEXT NOT NULL DEFAULT '',
  "state" VARCHAR(32) NOT NULL,
  "actor_id" VARCHAR(160) NOT NULL DEFAULT '',
  "run_id" VARCHAR(160) NOT NULL DEFAULT '',
  "idempotency_key" VARCHAR(240) NOT NULL DEFAULT '',
  "receipt" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "a2a_spoke_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "a2a_spoke_tasks_task_id_key"
  ON "crm"."a2a_spoke_tasks"("task_id");

CREATE INDEX IF NOT EXISTS "a2a_spoke_tasks_organization_id_created_at_idx"
  ON "crm"."a2a_spoke_tasks"("organization_id", "created_at");
