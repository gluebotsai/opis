SELECT 
  {{dimension_select}}
  COUNT(*)::bigint AS high_probability_deals
FROM rpt.deals
WHERE is_open = TRUE 
  AND stage_weight >= 0.75
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
