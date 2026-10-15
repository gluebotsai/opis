-- Normalize email identity keys and prevent duplicate email rows per organization.

UPDATE cdp.identity_keys
SET key_value = lower(trim(key_value))
WHERE key_type IN ('email', 'email_secondary')
  AND key_value <> lower(trim(key_value));

DELETE FROM cdp.identity_keys older
USING cdp.identity_keys newer
WHERE older.organization_id = newer.organization_id
  AND older.key_type = newer.key_type
  AND lower(older.key_value) = lower(newer.key_value)
  AND older.identity_id < newer.identity_id;

WITH ranked_primary_emails AS (
  SELECT
    identity_id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, cdp_id
      ORDER BY created_at DESC NULLS LAST, identity_id DESC
    ) AS rn
  FROM cdp.identity_keys
  WHERE key_type = 'email'
)
UPDATE cdp.identity_keys ik
SET key_type = 'email_secondary'
FROM ranked_primary_emails r
WHERE ik.identity_id = r.identity_id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_keys_org_type_lower_email
  ON cdp.identity_keys (organization_id, key_type, lower(key_value))
  WHERE key_type IN ('email', 'email_secondary');

CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_keys_one_primary_email_per_contact
  ON cdp.identity_keys (organization_id, cdp_id)
  WHERE key_type = 'email';
