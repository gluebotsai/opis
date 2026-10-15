WITH ranked AS (
    SELECT
        ae.ticket_id,
        ae.organization_id,
        t.queue_id,
        t.queue_name,
        t.assignee_name,
        t.resolver_name,
        ae.created_at,
        ROW_NUMBER() OVER (
            PARTITION BY ae.organization_id, ae.ticket_id
            ORDER BY ae.created_at, ae.id
        ) AS assign_n
    FROM ticketing.audit_events ae
    JOIN ticketing.tickets t
        ON t.id = ae.ticket_id
       AND t.organization_id = ae.organization_id
    WHERE ae.action = 'ticket.assigned'
      AND ae.organization_id = {{org_id}}
      AND {{time_sql}}
      AND {{scope_sql}}
)
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS reassignment_count
FROM ranked
WHERE assign_n > 1
{{group_by_sql}}
