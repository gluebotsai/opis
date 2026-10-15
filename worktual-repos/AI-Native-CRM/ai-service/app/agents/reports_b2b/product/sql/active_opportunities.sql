SELECT 
  {{dimension_select}}
  COUNT(*)::bigint AS active_opportunities
FROM rpt.deals
WHERE is_open = TRUE
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
