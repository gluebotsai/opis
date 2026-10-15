SELECT
  {{dimension_select}}
  type AS activity_type,
  COUNT(*)::bigint AS activity_count
FROM rpt.activities
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
GROUP BY type{{extra_group_sql}}
ORDER BY activity_count DESC
{{limit_sql}}
