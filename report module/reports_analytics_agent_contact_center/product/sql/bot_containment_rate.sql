WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    COUNT(*) FILTER (WHERE handoff_reason IS NULL AND NOT is_bot_resolved_inactivity)::bigint AS contained_count,
    COUNT(*) FILTER (WHERE NOT is_bot_resolved_inactivity)::bigint AS eligible_count,
    ROUND(
        COUNT(*) FILTER (WHERE handoff_reason IS NULL AND NOT is_bot_resolved_inactivity)::numeric
        / NULLIF(COUNT(*) FILTER (WHERE NOT is_bot_resolved_inactivity), 0),
        4
    ) AS bot_containment_rate
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}
