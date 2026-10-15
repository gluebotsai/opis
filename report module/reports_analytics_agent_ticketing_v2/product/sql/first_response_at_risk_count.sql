WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS first_response_at_risk_count
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND first_response_at_risk
  AND {{filters_sql}}
{{group_by_sql}}
