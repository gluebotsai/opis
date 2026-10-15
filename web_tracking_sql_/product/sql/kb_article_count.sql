SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS kb_article_count
FROM ticketing.kb_articles
WHERE organization_id = {{org_id}}
  AND status = 'Published'
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
