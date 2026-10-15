SELECT
    COALESCE(
        COUNT(*) FILTER (WHERE status = 'accepted')::float
            / NULLIF(COUNT(*)::float, 0),
        0
    ) AS recommendation_acceptance_rate
FROM ticketing.proactive_recommendations
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
  AND {{filters_sql}}
