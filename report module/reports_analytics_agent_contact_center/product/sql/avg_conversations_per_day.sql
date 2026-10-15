WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    ROUND(
        COUNT(*)::numeric
        / NULLIF({{window_days_sql}}, 0),
        2
    ) AS avg_conversations_per_day
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}
