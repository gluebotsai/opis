WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    (COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::float
        / NULLIF(COUNT(*) FILTER (WHERE is_status_resolved)::float, 0)
    ) AS csat_response_rate
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND is_status_resolved
  AND {{filters_sql}}
{{group_by_sql}}
