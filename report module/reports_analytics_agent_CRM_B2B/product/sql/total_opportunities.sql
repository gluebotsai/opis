SELECT 
  {{dimension_select}}
  COUNT(*)::bigint AS total_opportunities
FROM rpt.deals
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
