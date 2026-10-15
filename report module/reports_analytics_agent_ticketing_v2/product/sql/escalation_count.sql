WITH event_rows AS (
    SELECT
        t.queue_name,
        t.assignee_name,
        t.resolver_name,
        ae.created_at
    FROM ticketing.audit_events ae
    JOIN ticketing.tickets t
        ON t.id = ae.ticket_id
       AND t.organization_id = ae.organization_id
    WHERE ae.organization_id = {{org_id}}
      AND ae.action = 'ticket.escalated'
      AND {{time_sql}}
      AND {{scope_sql}}
      AND {{filters_sql}}
)
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS escalation_count
FROM event_rows
{{group_by_sql}}
