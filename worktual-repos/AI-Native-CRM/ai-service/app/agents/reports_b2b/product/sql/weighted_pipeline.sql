SELECT 
  {{dimension_select}}
  COALESCE(SUM(weighted_amount), 0)::numeric(15,2) AS weighted_pipeline
FROM rpt.deals
WHERE is_open = TRUE
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
