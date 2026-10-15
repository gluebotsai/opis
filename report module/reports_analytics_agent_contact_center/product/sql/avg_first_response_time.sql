WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    ROUND(AVG(first_response_minutes)::numeric, 2) AS avg_first_response_time
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
  AND first_agent_response_at IS NOT NULL
  AND first_response_minutes >= 0
{{group_by_sql}}
{{limit_sql}}
