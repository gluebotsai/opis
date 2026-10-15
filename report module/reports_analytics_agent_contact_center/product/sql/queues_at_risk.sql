WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    COUNT(DISTINCT queue_id)::bigint AS queues_at_risk
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
  AND resolution_at_risk
{{limit_sql}}
