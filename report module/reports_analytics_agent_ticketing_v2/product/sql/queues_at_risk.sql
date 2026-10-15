WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    queue_name AS queue,
    COUNT(*)::bigint AS at_risk_tickets
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND resolution_at_risk
  AND queue_id IS NOT NULL
  AND {{filters_sql}}
GROUP BY queue_name
ORDER BY at_risk_tickets DESC
