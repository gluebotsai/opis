WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    COUNT(DISTINCT cp.id)::bigint AS active_customers
FROM base_ticket
JOIN ticketing.contact_profile cp
    ON cp.id = base_ticket.customer_id
   AND cp.organization_id = base_ticket.organization_id
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND cp.status = 'Active'
  AND {{filters_sql}}
