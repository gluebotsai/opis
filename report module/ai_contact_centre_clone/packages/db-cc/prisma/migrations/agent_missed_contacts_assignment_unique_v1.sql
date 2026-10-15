-- Prevent duplicate missed-contact rows when the same offer expiry is processed twice.

-- Remove duplicate rows created before this constraint (keep earliest per assignment).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY assignment_id
      ORDER BY missed_at ASC, id ASC
    ) AS row_num
  FROM ccass.agent_missed_contacts
  WHERE assignment_id IS NOT NULL
)
DELETE FROM ccass.agent_missed_contacts mc
USING ranked r
WHERE mc.id = r.id
  AND r.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_missed_contacts_assignment_unique
  ON ccass.agent_missed_contacts (assignment_id)
  WHERE assignment_id IS NOT NULL;
