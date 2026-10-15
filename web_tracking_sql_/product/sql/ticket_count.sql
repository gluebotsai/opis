WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS ticket_count
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}
