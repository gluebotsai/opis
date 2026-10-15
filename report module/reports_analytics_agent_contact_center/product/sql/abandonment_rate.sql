WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    COUNT(*) FILTER (WHERE is_abandoned)::bigint AS abandoned_count,
    COUNT(*) FILTER (WHERE queued_at IS NOT NULL)::bigint AS queued_count,
    ROUND(
        COUNT(*) FILTER (WHERE is_abandoned)::numeric
        / NULLIF(COUNT(*) FILTER (WHERE queued_at IS NOT NULL), 0),
        4
    ) AS abandonment_rate
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
  AND end_reason NOT IN ('superseded_by_new_voice_call', 'test_cleanup')
{{group_by_sql}}
{{limit_sql}}
