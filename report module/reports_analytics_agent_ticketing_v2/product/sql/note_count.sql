WITH note_rows AS (
    SELECT
        t.queue_name,
        t.assignee_name,
        t.resolver_name,
        n.created_at
    FROM ticketing.ticket_notes n
    JOIN ticketing.tickets t
        ON t.id = n.ticket_id
       AND t.organization_id = n.organization_id
    WHERE n.organization_id = {{org_id}}
      AND {{time_sql}}
      AND {{scope_sql}}
      AND {{filters_sql}}
)
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS note_count
FROM note_rows
{{group_by_sql}}
