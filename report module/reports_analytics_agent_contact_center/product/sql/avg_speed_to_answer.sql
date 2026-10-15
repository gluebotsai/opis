WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    ROUND(AVG(speed_to_answer_minutes)::numeric, 2) AS avg_speed_to_answer
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
  AND assigned_at IS NOT NULL
  AND queued_at IS NOT NULL
  AND speed_to_answer_minutes >= 0
{{group_by_sql}}
{{limit_sql}}
