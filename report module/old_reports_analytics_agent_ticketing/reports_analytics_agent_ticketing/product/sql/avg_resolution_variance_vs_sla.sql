WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    AVG(resolution_variance_hours) AS avg_resolution_variance_vs_sla
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND resolved_at IS NOT NULL
  AND due_at IS NOT NULL
  AND {{filters_sql}}
{{group_by_sql}}
