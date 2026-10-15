WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    COUNT(*) FILTER (WHERE sla_breached OR first_response_sla_missed OR resolution_sla_missed)::bigint AS breached_count,
    COUNT(*) FILTER (WHERE has_sla)::bigint AS total_with_sla,
    ROUND(
        COUNT(*) FILTER (WHERE sla_breached OR first_response_sla_missed OR resolution_sla_missed)::numeric
        / NULLIF(COUNT(*) FILTER (WHERE has_sla), 0),
        4
    ) AS sla_breach_rate
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}
