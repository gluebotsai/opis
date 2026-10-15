SELECT 
  {{dimension_select}}
  COALESCE(SUM(amount), 0)::numeric(15,2) AS lost_revenue
FROM rpt.deals
WHERE is_lost = TRUE
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
