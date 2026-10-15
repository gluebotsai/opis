-- Queue module schema additions (safe, additive only)

ALTER TABLE accounts.setup_ccaas_queues
  ADD COLUMN IF NOT EXISTS business_hours_id UUID,
  ADD COLUMN IF NOT EXISTS shift_types JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS skills JSONB NOT NULL DEFAULT '[]';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'setup_ccaas_queues_business_hours_id_fkey'
  ) THEN
    ALTER TABLE accounts.setup_ccaas_queues
      ADD CONSTRAINT setup_ccaas_queues_business_hours_id_fkey
      FOREIGN KEY (business_hours_id) REFERENCES accounts.setup_business_hours(id);
  END IF;
END $$;

ALTER TABLE accounts.setup_ccaas_queue_agents
  ADD COLUMN IF NOT EXISTS shift_type VARCHAR(32) NOT NULL DEFAULT 'Regular';

ALTER TABLE accounts.setup_users
  ADD COLUMN IF NOT EXISTS skills JSONB NOT NULL DEFAULT '[]';

ALTER TABLE accounts.setup_webchat_configs
  ADD COLUMN IF NOT EXISTS routing_queue_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'setup_webchat_configs_routing_queue_id_fkey'
  ) THEN
    ALTER TABLE accounts.setup_webchat_configs
      ADD CONSTRAINT setup_webchat_configs_routing_queue_id_fkey
      FOREIGN KEY (routing_queue_id) REFERENCES accounts.setup_ccaas_queues(id);
  END IF;
END $$;

ALTER TABLE ccass.agents
  ADD COLUMN IF NOT EXISTS setup_user_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_setup_user_id_key'
  ) THEN
    ALTER TABLE ccass.agents ADD CONSTRAINT agents_setup_user_id_key UNIQUE (setup_user_id);
  END IF;
END $$;

-- Drop legacy single-agent-per-user constraint if present
ALTER TABLE accounts.setup_ccaas_queue_agents
  DROP CONSTRAINT IF EXISTS setup_ccaas_queue_agents_user_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'setup_ccaas_queue_agents_queue_user_shift_key'
  ) THEN
    ALTER TABLE accounts.setup_ccaas_queue_agents
      ADD CONSTRAINT setup_ccaas_queue_agents_queue_user_shift_key
      UNIQUE (queue_id, user_id, shift_type);
  END IF;
END $$;

-- Backfill queue business hours from team
UPDATE accounts.setup_ccaas_queues q
SET business_hours_id = t.business_hours_id
FROM accounts.setup_teams t
WHERE q.team_id = t.id
  AND q.business_hours_id IS NULL
  AND t.business_hours_id IS NOT NULL;
