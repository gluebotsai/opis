-- Test data for webchat live-agent flow (data only — no accounts schema changes).
-- Webchat: wc_5d80cd9b1ace4080bc70717552472611
-- Org: ce4ff326-4c0e-43f2-a978-e6b494cd0775

-- 1. Bind webchat to the published "pre sales" queue
UPDATE accounts.setup_webchat_configs
SET routing_queue_id = '81019f3d-826b-498f-8273-18abe4df6dba'
WHERE webchat_id = 'wc_5d80cd9b1ace4080bc70717552472611'
  AND routing_queue_id IS NULL;

-- 2. Enable chat handling for the primary test agent on that queue (accounts setup)
UPDATE accounts.setup_ccaas_queue_agents
SET handles_chat = TRUE,
    chat_concurrency = GREATEST(chat_concurrency, 3)
WHERE queue_id = '81019f3d-826b-498f-8273-18abe4df6dba'
  AND user_id = '18551085-82d6-436b-b8a9-7bc02a64a454';

-- 3. Mirror chat handling on runtime queue membership (ccass)
UPDATE ccass.queue_members
SET handles_chat = TRUE,
    chat_concurrency = GREATEST(chat_concurrency, 3)
WHERE queue_id = '81019f3d-826b-498f-8273-18abe4df6dba'
  AND setup_user_id = '18551085-82d6-436b-b8a9-7bc02a64a454';

-- 4. Ensure agent chat capacity row exists
INSERT INTO ccass.agent_capacity (
  organization_id,
  agent_id,
  channel,
  max_concurrency,
  reserved_count,
  active_count
)
SELECT
  'ce4ff326-4c0e-43f2-a978-e6b494cd0775'::uuid,
  'e4ef1989-46ce-4f14-aecd-6944417bfc3d'::uuid,
  'chat',
  3,
  0,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM ccass.agent_capacity
  WHERE agent_id = 'e4ef1989-46ce-4f14-aecd-6944417bfc3d'::uuid
    AND channel = 'chat'
);

-- 5. Seed routing cursor for round-robin on the queue
INSERT INTO ccass.routing_cursors (organization_id, queue_id, cursor_index)
VALUES (
  'ce4ff326-4c0e-43f2-a978-e6b494cd0775'::uuid,
  '81019f3d-826b-498f-8273-18abe4df6dba'::uuid,
  0
)
ON CONFLICT (queue_id) DO NOTHING;

-- 6. Default routing policy for the queue
INSERT INTO ccass.routing_policies (
  organization_id,
  queue_id,
  strategy,
  offer_timeout_seconds,
  max_attempts
)
SELECT
  'ce4ff326-4c0e-43f2-a978-e6b494cd0775'::uuid,
  '81019f3d-826b-498f-8273-18abe4df6dba'::uuid,
  'round_robin',
  20,
  3
WHERE NOT EXISTS (
  SELECT 1 FROM ccass.routing_policies
  WHERE queue_id = '81019f3d-826b-498f-8273-18abe4df6dba'::uuid
);

-- 7. Mark test agent as ready for routing (Postgres secondary; Redis refreshed on next heartbeat)
INSERT INTO ccass.agent_presence (
  organization_id,
  agent_id,
  status,
  presence_state,
  heartbeat_at,
  lease_expires_at,
  source
)
VALUES (
  'ce4ff326-4c0e-43f2-a978-e6b494cd0775'::uuid,
  'e4ef1989-46ce-4f14-aecd-6944417bfc3d'::uuid,
  'ready',
  'ready',
  NOW(),
  NOW() + INTERVAL '90 seconds',
  'seed'
)
ON CONFLICT (agent_id) DO UPDATE
SET
  status = 'ready',
  presence_state = 'ready',
  heartbeat_at = NOW(),
  lease_expires_at = NOW() + INTERVAL '90 seconds',
  updated_at = NOW(),
  source = 'seed';
