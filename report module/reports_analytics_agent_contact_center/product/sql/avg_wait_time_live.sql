WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - queued_at)) / 60.0)::numeric, 2) AS avg_wait_time_live
FROM base_conversation
WHERE status = 'queued'
  AND queued_at IS NOT NULL
  AND {{scope_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}
