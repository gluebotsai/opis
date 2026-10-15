-- Hub → Ticketing inbound A2A client (accounts.a2a_spoke_clients)
-- Run against shared Postgres (same DATABASE_URL as Ticketing).
-- Replace client_secret before applying in production.

INSERT INTO accounts.a2a_spoke_clients (
  a2a_server_name, client_id, client_secret
)
SELECT
  'worktual-ticketing',
  'worktual-hub-ticketing',
  'change-me-ticketing-a2a-spoke-secret'
WHERE NOT EXISTS (
  SELECT 1
  FROM accounts.a2a_spoke_clients
  WHERE a2a_server_name = 'worktual-ticketing'
    AND client_id = 'worktual-hub-ticketing'
);
