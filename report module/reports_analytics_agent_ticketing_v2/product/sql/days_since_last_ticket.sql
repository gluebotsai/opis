WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 86400.0 AS days_since_last_ticket
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
