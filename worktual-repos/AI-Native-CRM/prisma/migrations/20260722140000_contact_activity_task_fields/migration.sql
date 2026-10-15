-- Task fields on contact_activities: assignee + workflow status

CREATE TYPE "TaskStatus" AS ENUM ('open', 'in_progress', 'completed');

ALTER TABLE "contact_activities"
  ADD COLUMN IF NOT EXISTS "assignee_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "task_status" "TaskStatus";

-- Existing task rows: treat as open when they have no status yet
UPDATE "contact_activities"
SET "task_status" = 'open'
WHERE "type" = 'task' AND "task_status" IS NULL;

CREATE INDEX IF NOT EXISTS "contact_activities_assignee_user_id_task_status_due_at_idx"
  ON "contact_activities" ("assignee_user_id", "task_status", "due_at");
