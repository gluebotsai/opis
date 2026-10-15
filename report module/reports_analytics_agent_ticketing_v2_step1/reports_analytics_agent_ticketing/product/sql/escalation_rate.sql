WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    (COUNT(*) FILTER (
        WHERE EXISTS (
            SELECT 1
            FROM ticketing.audit_events ae
            WHERE ae.organization_id = base_ticket.organization_id
              AND ae.ticket_id::text = base_ticket.ticket_id::text
              AND ae.action = 'ticket.escalated'
        )
    )::float / NULLIF(COUNT(*)::float, 0)) AS escalation_rate
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
