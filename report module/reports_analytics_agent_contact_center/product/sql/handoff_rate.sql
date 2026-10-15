WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    COUNT(*) FILTER (WHERE handoff_reason IS NOT NULL)::bigint AS handoff_count,
    COUNT(*)::bigint AS total_conversations,
    ROUND(
        COUNT(*) FILTER (WHERE handoff_reason IS NOT NULL)::numeric
        / NULLIF(COUNT(*), 0),
        4
    ) AS handoff_rate
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}
