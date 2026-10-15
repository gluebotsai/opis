WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    resolution_code,
    COUNT(*)::bigint AS conversation_count
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
  AND resolution_code IS NOT NULL
GROUP BY resolution_code {{group_by_extra}}
{{limit_sql}}
