-- Allow contact-less agent step events (e.g. company-only sales_assignment runs).
ALTER TABLE "agent_step_events" ALTER COLUMN "contact_id" DROP NOT NULL;
