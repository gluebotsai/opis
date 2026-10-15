WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    COUNT(DISTINCT cp.account_id)::bigint AS accounts_served
FROM base_ticket
JOIN ticketing.contact_profile cp
    ON cp.id = base_ticket.customer_id
   AND cp.organization_id = base_ticket.organization_id
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND cp.account_id IS NOT NULL
  AND {{filters_sql}}
{{group_by_sql}}
