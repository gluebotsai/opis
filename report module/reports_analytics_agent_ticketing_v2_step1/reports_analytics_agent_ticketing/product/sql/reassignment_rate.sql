WITH base_ticket AS (
{{base_ticket}}
), assigned AS (
    SELECT
        ae.ticket_id,
        ae.organization_id,
        COUNT(*) AS assigned_events
    FROM ticketing.audit_events ae
    WHERE ae.action = 'ticket.assigned'
      AND ae.organization_id IN (SELECT organization_id FROM base_ticket)
    GROUP BY ae.ticket_id, ae.organization_id
)
SELECT
    {{dimension_select}}
    (COUNT(*) FILTER (WHERE assigned.assigned_events > 1)::float
        / NULLIF(COUNT(*) FILTER (WHERE assigned.assigned_events >= 1)::float, 0)) AS reassignment_rate
FROM base_ticket
LEFT JOIN assigned
    ON assigned.ticket_id::text = base_ticket.ticket_id::text
   AND assigned.organization_id = base_ticket.organization_id
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
