WITH base_ticket AS (
{{base_ticket}}
)
SELECT
    {{dimension_select}}
    (COUNT(*) FILTER (WHERE csat_score >= 4)::float
        / NULLIF(COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::float, 0)
    ) AS promoter_rate,
    (COUNT(*) FILTER (WHERE csat_score = 3)::float
        / NULLIF(COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::float, 0)
    ) AS neutral_rate,
    (COUNT(*) FILTER (WHERE csat_score <= 2)::float
        / NULLIF(COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::float, 0)
    ) AS detractor_rate,
    COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::bigint AS rated_tickets
FROM base_ticket
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND csat_score IS NOT NULL
  AND {{filters_sql}}
{{group_by_sql}}
