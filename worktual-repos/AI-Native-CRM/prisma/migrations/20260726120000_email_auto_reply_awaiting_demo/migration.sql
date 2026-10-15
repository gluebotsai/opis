-- Demo booking multi-turn: keep the agent on the thread until booked/escalated.

DO $$ BEGIN
  ALTER TYPE "EmailAutoReplyStatus" ADD VALUE IF NOT EXISTS 'awaiting_demo';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
