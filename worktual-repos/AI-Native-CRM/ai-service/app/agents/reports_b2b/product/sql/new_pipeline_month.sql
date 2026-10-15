SELECT 
  {{dimension_select}}
  COALESCE(SUM(amount), 0)::numeric(15,2) AS new_pipeline_month
FROM rpt.deals
WHERE created_at >= DATE_TRUNC('month', NOW())
  AND created_at < NOW()
  AND {{scope_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
