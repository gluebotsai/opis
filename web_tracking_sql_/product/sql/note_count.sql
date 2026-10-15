SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS note_count
FROM ticketing.ticket_notes n
JOIN ticketing.tickets t
    ON t.id = n.ticket_id
   AND t.organization_id = n.organization_id
WHERE n.organization_id = {{org_id}}
  AND {{time_sql}}
  AND {{scope_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
