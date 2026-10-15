-- Callbacks are for agents. Admins can assign them, but cannot be the assignee.
-- Open callbacks already assigned to an admin are left unassigned.

ALTER TABLE ccass.agent_tasks
  ALTER COLUMN assigned_user_id DROP NOT NULL;

UPDATE ccass.agent_tasks t
SET assigned_user_id = NULL,
    updated_at = NOW()
WHERE t.task_type = 'callback'
  AND t.status = 'open'
  AND t.assigned_user_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM accounts.setup_user_product_access supa
    INNER JOIN accounts.setup_roles sr ON sr.id = supa.role_id
    WHERE supa.user_id = t.assigned_user_id
      AND supa.organization_id = t.organization_id
      AND supa.product_id = 'contact-center'
      AND LOWER(TRIM(sr.name)) IN ('admin', 'administrator', 'manager', 'supervisor')
  );
