SELECT 
  {{dimension_select}}
  COUNT(*)::bigint AS won_deal_count
FROM rpt.deals
WHERE is_won = TRUE
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
