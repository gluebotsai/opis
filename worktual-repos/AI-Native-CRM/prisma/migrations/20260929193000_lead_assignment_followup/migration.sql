-- Lead assignment follow-up cadence. CRM schema only.
ALTER TABLE "crm"."contact_profiles"
  ADD COLUMN IF NOT EXISTS "assignment_followup_stage" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "assignment_baseline_status" VARCHAR(32);

ALTER TABLE "crm"."org_assignment_settings"
  ADD COLUMN IF NOT EXISTS "followup_policy" JSONB;

CREATE INDEX IF NOT EXISTS "contact_profiles_assignment_followup_due_idx"
  ON "crm"."contact_profiles" ("sla_deadline")
  WHERE "assignment_followup_stage" IS NOT NULL
    AND "assignment_followup_stage" NOT IN ('acted', 'admin_notified');
