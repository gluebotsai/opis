WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    ROUND(AVG(wait_time_minutes)::numeric, 2) AS avg_wait_time
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
  AND queued_at IS NOT NULL
  AND COALESCE(assigned_at, ended_at) IS NOT NULL
  AND wait_time_minutes >= 0
{{group_by_sql}}
{{limit_sql}}
