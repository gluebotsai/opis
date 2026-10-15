ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "launch_plan" JSONB;
