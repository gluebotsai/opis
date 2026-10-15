WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS no_sla_count
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND resolution_no_sla
  AND {{filters_sql}}
{{group_by_sql}}
