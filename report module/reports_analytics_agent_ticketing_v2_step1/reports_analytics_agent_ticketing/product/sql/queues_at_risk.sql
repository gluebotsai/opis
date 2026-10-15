WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    COUNT(DISTINCT queue_id)::bigint AS queues_at_risk
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND resolution_at_risk
  AND queue_id IS NOT NULL
  AND {{filters_sql}}
