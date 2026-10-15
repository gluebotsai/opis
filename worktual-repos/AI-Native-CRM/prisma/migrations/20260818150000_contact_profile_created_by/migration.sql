-- Sales reps see contacts they own *or* created. Leads stay pooled
-- (owner_user_id null) until score ≥ 40, so created_by is required for
-- the creator's list. CRM overlay only — no cdp/accounts DDL.

ALTER TABLE crm.contact_profiles
  ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT;

CREATE INDEX IF NOT EXISTS contact_profiles_created_by_user_id_idx
  ON crm.contact_profiles (created_by_user_id);

-- Best-effort backfill from the earliest contact audit actor (entity_id = CDP id).
UPDATE crm.contact_profiles cp
SET created_by_user_id = al.actor_user_id
FROM (
  SELECT DISTINCT ON (entity_id)
    entity_id,
    actor_user_id
  FROM crm.audit_logs
  WHERE entity_type = 'contact'
    AND actor_user_id IS NOT NULL
  ORDER BY entity_id, created_at ASC
) al
WHERE al.entity_id = cp.account_contact_id
  AND cp.created_by_user_id IS NULL;
