SELECT COALESCE(SUM(views), 0)::bigint AS kb_views
FROM ticketing.kb_articles
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
  AND {{filters_sql}}
