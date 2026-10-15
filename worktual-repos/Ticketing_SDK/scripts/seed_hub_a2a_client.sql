-- One-time seed: Ticketing → Hub A2A client row on shared MyAccount DB.
-- Replace CHANGE_ME_HUB_A2A_CLIENT_SECRET with the same value as HUB_A2A_CLIENT_SECRET in .env.
-- Prefer: python scripts/seed_hub_a2a_client.py (reads env automatically).
--
-- Table (Hub/CRM shared): accounts.a2a_spoke_clients
-- Unique on a2a_server_name + client_id (exact constraints may vary by Hub DDL).

INSERT INTO accounts.a2a_spoke_clients (
  a2a_server_name,
  client_id,
  client_secret
)
SELECT
  'worktual-hub',
  'worktual-ticketing-hub',
  'CHANGE_ME_HUB_A2A_CLIENT_SECRET'
WHERE NOT EXISTS (
  SELECT 1
  FROM accounts.a2a_spoke_clients
  WHERE a2a_server_name = 'worktual-hub'
    AND client_id = 'worktual-ticketing-hub'
);
