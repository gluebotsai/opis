WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    (COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::float
        / NULLIF(COUNT(*)::float, 0)
    ) AS csat_response_rate
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND (is_status_resolved OR is_status_closed OR resolved_at IS NOT NULL)
  AND {{filters_sql}}
{{group_by_sql}}
