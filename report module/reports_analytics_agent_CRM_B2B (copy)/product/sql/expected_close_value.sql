SELECT 
  {{dimension_select}}
  COALESCE(SUM(amount), 0)::numeric(15,2) AS expected_close_value,
  COALESCE(SUM(weighted_amount), 0)::numeric(15,2) AS weighted_expected_close_value
FROM rpt.deals
WHERE is_open = TRUE
  AND expected_close_date IS NOT NULL
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
