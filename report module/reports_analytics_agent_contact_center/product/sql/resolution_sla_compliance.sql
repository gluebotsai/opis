WITH base_conversation AS (
{{base_conversation}}
)
SELECT
    {{dimension_select}}
    COUNT(*) FILTER (WHERE resolution_sla_met)::bigint AS met_count,
    COUNT(*) FILTER (WHERE resolution_sla_met OR resolution_sla_missed)::bigint AS decided_count,
    ROUND(
        COUNT(*) FILTER (WHERE resolution_sla_met)::numeric
        / NULLIF(COUNT(*) FILTER (WHERE resolution_sla_met OR resolution_sla_missed), 0),
        4
    ) AS resolution_sla_compliance
FROM base_conversation
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
  AND resolution_due_at IS NOT NULL
{{group_by_sql}}
{{limit_sql}}
