SELECT 
  {{dimension_select}}
  COALESCE(ROUND(AVG(stage_weight) * 100.0, 2), 0.00) AS average_probability
FROM rpt.deals
WHERE is_open = TRUE
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
