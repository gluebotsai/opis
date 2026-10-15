WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    COUNT(DISTINCT customer_id)::bigint AS customers_served
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND customer_id IS NOT NULL
  AND {{filters_sql}}
{{group_by_sql}}
