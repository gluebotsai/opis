WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    AVG(first_response_hours) AS avg_first_response_time
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND first_response_at IS NOT NULL
  AND {{filters_sql}}
{{group_by_sql}}
