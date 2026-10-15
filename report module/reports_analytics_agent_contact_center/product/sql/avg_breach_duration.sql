WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    ROUND(
        AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, NOW()) - resolution_due_at)) / 60.0)::numeric,
        2
    ) AS avg_breach_duration
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
  AND (sla_breached OR resolution_sla_missed)
  AND resolution_due_at IS NOT NULL
{{group_by_sql}}
{{limit_sql}}
