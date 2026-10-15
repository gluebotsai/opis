WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0) AS avg_open_ticket_age
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND is_status_open
  AND {{filters_sql}}
{{group_by_sql}}
