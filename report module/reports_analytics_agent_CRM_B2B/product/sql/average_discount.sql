SELECT 
  {{dimension_select}}
  COALESCE(ROUND(AVG(discount_pct), 2), 0.00) AS avg_discount_pct,
  COALESCE(SUM(discount_amount), 0)::numeric(15,2) AS total_discount_amount
FROM rpt.quotes
WHERE status IN ('sent', 'accepted')
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
