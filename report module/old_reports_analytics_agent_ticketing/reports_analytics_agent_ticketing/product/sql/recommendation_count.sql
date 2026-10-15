SELECT COUNT(*)::bigint AS recommendation_count
FROM ticketing.proactive_recommendations
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
