WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    ROUND(AVG(resolution_duration_minutes)::numeric, 2) AS avg_resolution_time
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
  AND resolved_at IS NOT NULL
  AND resolution_duration_minutes >= 0
{{group_by_sql}}
{{limit_sql}}
