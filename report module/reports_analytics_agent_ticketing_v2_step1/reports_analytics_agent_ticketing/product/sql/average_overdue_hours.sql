WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    AVG(overdue_hours_so_far) AS average_overdue_hours
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND resolution_sla_missed
  AND due_at IS NOT NULL
  AND {{filters_sql}}
{{group_by_sql}}
