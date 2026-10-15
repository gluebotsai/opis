-- Seed / upsert Campaign A2A rows on shared accounts.a2a_spoke_clients
-- Unique on a2a_server_name (and typically client_id).

-- Hub → Campaign (Campaign mints tokens on POST :8040/token)
INSERT INTO accounts.a2a_spoke_clients (
  a2a_server_name,
  client_id,
  client_secret,
  created_at,
  updated_at
) VALUES (
  'worktual-campaign',
  'worktual-hub-campaign',
  'MA7fdPQALkoFmS3GMFadDAxvVKfAX45C_HoAqlhlkxE',
  NOW(),
  NOW()
)
ON CONFLICT (a2a_server_name) DO UPDATE
SET client_id = EXCLUDED.client_id,
    client_secret = EXCLUDED.client_secret,
    updated_at = NOW();

-- Campaign → Hub peer row (Hub must issue worktual-campaign-hub + secret)
INSERT INTO accounts.a2a_spoke_clients (
  a2a_server_name,
  client_id,
  client_secret,
  created_at,
  updated_at
) VALUES (
  'worktual-hub',
  'worktual-campaign-hub',
  'SET_ME_WHEN_HUB_ISSUES_SECRET',
  NOW(),
  NOW()
)
ON CONFLICT (a2a_server_name) DO NOTHING;

-- Verify after POST /token on Campaign:
-- SELECT a2a_server_name, client_id,
--        left(access_token, 24) AS access_prefix,
--        left(refresh_token, 16) AS refresh_prefix,
--        access_expires_at, updated_at
-- FROM accounts.a2a_spoke_clients
-- WHERE a2a_server_name = 'worktual-campaign';
