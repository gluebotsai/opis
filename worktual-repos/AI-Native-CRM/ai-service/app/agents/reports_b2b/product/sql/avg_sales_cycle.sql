SELECT 
  {{dimension_select}}
  COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (closed_at - created_at))/86400), 1), 0.0) AS avg_sales_cycle_days
FROM rpt.deals
WHERE is_won = TRUE 
  AND closed_at > created_at
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
