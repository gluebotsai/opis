WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    (COUNT(*) FILTER (WHERE {{segment_predicate}})::float
        / NULLIF(COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::float, 0)
    ) AS csat_distribution_rate
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND csat_score IS NOT NULL
  AND {{filters_sql}}
{{group_by_sql}}
