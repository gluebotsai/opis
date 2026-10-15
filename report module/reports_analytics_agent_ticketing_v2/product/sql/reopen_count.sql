WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS reopen_count
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND status = 'Reopened'
  AND {{filters_sql}}
{{group_by_sql}}
