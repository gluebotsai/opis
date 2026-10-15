WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS call_count
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
  AND channel IN ('call', 'voice')
{{group_by_sql}}
{{limit_sql}}
