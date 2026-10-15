WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    AVG(csat_score)::float AS avg_csat
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND csat_score IS NOT NULL
  AND {{filters_sql}}
{{group_by_sql}}
