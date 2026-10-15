WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    (COUNT(*) FILTER (WHERE status = 'Reopened')::float
        / NULLIF(COUNT(*) FILTER (WHERE status IN ('Resolved', 'Closed', 'Reopened'))::float, 0)
    ) AS reopen_rate
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
