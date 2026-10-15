-- Queue agent voice direction flags (setup_ccaas_queue_agents_call_flags_chk).

ALTER TABLE accounts.setup_ccaas_queue_agents
  ADD COLUMN IF NOT EXISTS handles_inbound BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS handles_outbound BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS handles_outbound_campaign BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE accounts.setup_ccaas_queue_agents
SET
  handles_inbound = handles_calls AND call_type IN ('inbound', 'both'),
  handles_outbound = handles_calls AND call_type IN ('outbound', 'both'),
  handles_outbound_campaign = FALSE
WHERE handles_calls = TRUE
  AND (handles_inbound = FALSE AND handles_outbound = FALSE AND handles_outbound_campaign = FALSE);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'setup_ccaas_queue_agents_call_flags_chk'
  ) THEN
    ALTER TABLE accounts.setup_ccaas_queue_agents
      ADD CONSTRAINT setup_ccaas_queue_agents_call_flags_chk
      CHECK (
        handles_calls = (
          handles_inbound OR handles_outbound OR handles_outbound_campaign
        )
      );
  END IF;
END $$;
