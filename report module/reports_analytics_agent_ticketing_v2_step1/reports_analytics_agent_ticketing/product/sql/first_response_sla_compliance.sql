WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    (COUNT(*) FILTER (WHERE first_response_sla_met)::float
        / NULLIF(COUNT(*) FILTER (WHERE first_response_sla_met OR first_response_sla_missed)::float, 0)
    ) AS first_response_sla_compliance
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
