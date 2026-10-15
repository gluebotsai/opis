-- Drop person display columns from contact_profile (SoR is CDP).
-- Recreate staging/marts views that depended on name/email columns.

BEGIN;

-- Marts depend on stg_customers column types; drop then recreate.
DROP VIEW IF EXISTS ticketing_marts.mart_tickets;
DROP VIEW IF EXISTS ticketing_marts.mart_customers;
DROP VIEW IF EXISTS ticketing_staging.stg_customers;

CREATE VIEW ticketing_staging.stg_customers AS
SELECT
  cp.id::text AS customer_id,
  cp.organization_id::text AS organization_id,
  cp.account_id::text AS account_id,
  cp.external_id,
  NULLIF(trim(both ' ' FROM concat_ws(' ', p.first_name, p.last_name)), '')::text AS customer_name,
  (
    SELECT ik.key_value::text
    FROM cdp.identity_keys ik
    WHERE ik.cdp_id = cp.cdp_id
      AND ik.organization_id = cp.organization_id
      AND ik.key_type = 'email'
    LIMIT 1
  ) AS customer_email,
  cp.status,
  cp.total_tickets,
  cp.created_at,
  cp.updated_at,
  cp.cdp_id
FROM ticketing.contact_profile cp
LEFT JOIN cdp.customer_profile p
  ON p.cdp_id = cp.cdp_id
 AND p.organization_id = cp.organization_id;

CREATE VIEW ticketing_marts.mart_customers AS
SELECT
  customer_id,
  organization_id,
  account_id,
  external_id,
  customer_name,
  customer_email,
  status,
  status = 'Active' OR lower(status) = 'active' AS is_active,
  total_tickets,
  created_at,
  updated_at
FROM ticketing_staging.stg_customers;

-- Recreate mart_tickets (same join shape as before; definition from live DB).
CREATE VIEW ticketing_marts.mart_tickets AS
SELECT t.ticket_id,
  t.organization_id,
  o.organization_name,
  o.business_type AS organization_business_type,
  t.ticket_number,
  t.subject,
  t.status,
  ts.status_display_name,
  ts.is_terminal AS is_closed_by_status,
  t.priority,
  t.channel,
  t.customer_id,
  t.customer_name,
  t.customer_email,
  c.account_id,
  a.account_name,
  t.assignee_id,
  t.assignee_name,
  u.role AS assignee_role,
  t.resolver_id,
  t.resolver_name,
  t.queue_id,
  t.queue_name,
  q.queue_type,
  q.sla_status AS queue_sla_status,
  true AS team_supports_ticketing,
  t.category,
  t.skill,
  t.due_at,
  t.first_response_at,
  t.resolved_at,
  t.csat_score,
  t.csat_rated_at,
  t.created_by_id,
  t.created_by_name,
  t.is_resolved,
  CASE
    WHEN NOT COALESCE(ts.is_terminal, false) AND t.status::text <> 'Resolved'::text THEN true
    ELSE false
  END AS is_open,
  CASE
    WHEN t.status::text = 'Overdue'::text
      OR (t.due_at IS NOT NULL AND t.due_at < now()
          AND NOT COALESCE(ts.is_terminal, false)
          AND t.status::text <> 'Resolved'::text) THEN true
    ELSE false
  END AS is_overdue,
  CASE
    WHEN NOT COALESCE(ts.is_terminal, false)
     AND t.status::text <> 'Resolved'::text
     AND (lower(t.priority::text) = ANY (ARRAY['high'::text, 'urgent'::text])) THEN true
    ELSE false
  END AS is_high_priority_open,
  CASE
    WHEN NOT COALESCE(ts.is_terminal, false)
     AND t.status::text <> 'Resolved'::text
     AND t.due_at IS NOT NULL
     AND date(t.due_at) = CURRENT_DATE THEN true
    ELSE false
  END AS is_due_today,
  CASE
    WHEN NOT COALESCE(ts.is_terminal, false)
     AND t.status::text <> 'Resolved'::text
     AND t.due_at IS NOT NULL
     AND t.due_at > now()
     AND t.due_at <= (now() + '04:00:00'::interval) THEN true
    ELSE false
  END AS is_sla_at_risk,
  CASE
    WHEN (t.status::text = 'Overdue'::text
          OR (t.due_at IS NOT NULL AND t.due_at < now()
              AND NOT COALESCE(ts.is_terminal, false)
              AND t.status::text <> 'Resolved'::text))
     AND t.due_at IS NOT NULL
    THEN EXTRACT(epoch FROM now() - t.due_at) / 3600.0
    ELSE NULL::numeric
  END AS overdue_hours,
  CASE
    WHEN t.resolved_at IS NOT NULL AND t.due_at IS NOT NULL AND t.resolved_at <= t.due_at THEN true
    WHEN t.is_resolved AND sp.resolution_hours IS NOT NULL
     AND t.resolution_hours <= sp.resolution_hours::numeric THEN true
    ELSE false
  END AS is_resolution_sla_met,
  CASE
    WHEN t.resolved_at IS NOT NULL
     AND (t.due_at IS NOT NULL OR sp.resolution_hours IS NOT NULL) THEN true
    ELSE false
  END AS has_resolution_sla_target,
  sp.resolution_hours AS sla_resolution_hours,
  sp.first_response_hours AS sla_first_response_hours,
  CASE
    WHEN t.is_resolved AND sp.resolution_hours IS NOT NULL
    THEN t.resolution_hours - sp.resolution_hours::numeric
    ELSE NULL::numeric
  END AS resolution_hours_variance,
  t.created_at,
  t.updated_at
FROM ticketing_staging.stg_tickets t
LEFT JOIN ticketing_staging.stg_customers c
  ON t.customer_id = c.customer_id AND t.organization_id = c.organization_id
LEFT JOIN ticketing_staging.stg_accounts a
  ON c.account_id = a.account_id AND t.organization_id = a.organization_id
LEFT JOIN ticketing_staging.stg_agent_queues q
  ON t.queue_id = q.queue_id AND t.organization_id = q.organization_id
LEFT JOIN ticketing_staging.stg_users u
  ON t.assignee_id = u.user_id AND t.organization_id = u.organization_id
LEFT JOIN ticketing_staging.stg_organizations o
  ON t.organization_id = o.organization_id
LEFT JOIN ticketing_staging.stg_ticket_statuses ts
  ON t.status::text = ts.status AND t.organization_id = ts.organization_id
LEFT JOIN ticketing_staging.stg_sla_policies sp
  ON t.priority::text = sp.priority AND t.organization_id = sp.organization_id;

DROP INDEX IF EXISTS ticketing.idx_contact_profile_org_email_ci;
DROP INDEX IF EXISTS ticketing.idx_contact_profile_org_phone;
ALTER TABLE ticketing.contact_profile
  DROP CONSTRAINT IF EXISTS customers_organization_id_email_key;
ALTER TABLE ticketing.contact_profile
  DROP CONSTRAINT IF EXISTS contact_profile_organization_id_email_key;

ALTER TABLE ticketing.contact_profile DROP COLUMN IF EXISTS name;
ALTER TABLE ticketing.contact_profile DROP COLUMN IF EXISTS email;
ALTER TABLE ticketing.contact_profile DROP COLUMN IF EXISTS phone;

COMMENT ON TABLE ticketing.contact_profile IS
  'Support contact ops + portal auth only. Person details: cdp.customer_profile + cdp.identity_keys via cdp_id.';

COMMIT;
