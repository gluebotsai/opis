WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    (COUNT(*) FILTER (WHERE is_status_resolved OR is_status_closed)::float
        / NULLIF(COUNT(*)::float, 0)) AS resolution_rate
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
