-- Curated step-by-step trace for proactive agent runs (lead enrichment first).

-- CreateEnum
CREATE TYPE "AgentStepStatus" AS ENUM ('started', 'ok', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "agent_step_events" (
    "id" TEXT NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "agent" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "AgentStepStatus" NOT NULL DEFAULT 'started',
    "detail" JSONB,
    "error_reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "agent_step_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_step_events_job_id_step_key" ON "agent_step_events"("job_id", "step");

-- CreateIndex
CREATE INDEX "agent_step_events_contact_id_started_at_idx" ON "agent_step_events"("contact_id", "started_at");

-- CreateIndex
CREATE INDEX "agent_step_events_organization_id_agent_started_at_idx" ON "agent_step_events"("organization_id", "agent", "started_at");
