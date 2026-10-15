-- Backfill conversation agent attribution cleared by test cleanup or missing on accept.
-- Safe to run multiple times.

UPDATE ccass.conversations c
SET
  assigned_user_id = src.setup_user_id,
  assigned_agent_id = COALESCE(c.assigned_agent_id, src.agent_id),
  updated_at = NOW()
FROM (
  SELECT DISTINCT ON (ca.conversation_id, ca.organization_id)
    ca.conversation_id,
    ca.organization_id,
    ca.agent_id,
    a.setup_user_id
  FROM ccass.conversation_assignments ca
  INNER JOIN ccass.agents a ON a.id = ca.agent_id
  WHERE ca.state IN ('accepted', 'ended')
    AND a.setup_user_id IS NOT NULL
  ORDER BY ca.conversation_id, ca.organization_id, ca.accepted_at DESC NULLS LAST, ca.id DESC
) src
WHERE c.id = src.conversation_id
  AND c.organization_id = src.organization_id
  AND c.assigned_user_id IS NULL;

UPDATE ccass.conversations c
SET
  assigned_at = src.accepted_at,
  updated_at = NOW()
FROM (
  SELECT DISTINCT ON (ca.conversation_id, ca.organization_id)
    ca.conversation_id,
    ca.organization_id,
    ca.accepted_at
  FROM ccass.conversation_assignments ca
  WHERE ca.state IN ('accepted', 'ended')
    AND ca.accepted_at IS NOT NULL
  ORDER BY ca.conversation_id, ca.organization_id, ca.accepted_at DESC NULLS LAST, ca.id DESC
) src
WHERE c.id = src.conversation_id
  AND c.organization_id = src.organization_id
  AND c.assigned_at IS NULL;
