WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    (COUNT(*) FILTER (WHERE resolution_sla_met)::float
        / NULLIF(COUNT(*) FILTER (WHERE resolution_sla_met OR resolution_sla_missed)::float, 0)
    ) AS resolution_sla_compliance
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
