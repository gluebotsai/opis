WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    ROUND(AVG(handle_time_minutes)::numeric, 2) AS avg_handle_time
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
  AND assigned_at IS NOT NULL
  AND ended_at IS NOT NULL
  AND handle_time_minutes >= 0
  AND channel NOT IN ('call', 'voice')
{{group_by_sql}}
{{limit_sql}}
