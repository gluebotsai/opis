SELECT 
  {{dimension_select}}
  COALESCE(ROUND(AVG(aging_days), 1), 0.0) AS average_aging
FROM rpt.deals
WHERE is_open = TRUE
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
