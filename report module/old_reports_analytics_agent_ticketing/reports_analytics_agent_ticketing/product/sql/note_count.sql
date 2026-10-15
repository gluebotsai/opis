SELECT COUNT(*)::bigint AS note_count
FROM ticketing.ticket_notes n
JOIN ticketing.tickets t
    ON t.id::text = n.ticket_id::text
   AND t.organization_id = n.organization_id
WHERE n.organization_id = {{org_id}}
  AND {{time_sql}}
  AND {{scope_sql}}
  AND {{filters_sql}}
