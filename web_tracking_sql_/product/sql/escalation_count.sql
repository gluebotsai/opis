SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS escalation_count
FROM ticketing.audit_events ae
JOIN ticketing.tickets t
    ON t.id = ae.ticket_id
   AND t.organization_id = ae.organization_id
WHERE ae.organization_id = {{org_id}}
  AND ae.action = 'ticket.escalated'
  AND {{time_sql}}
  AND {{scope_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
