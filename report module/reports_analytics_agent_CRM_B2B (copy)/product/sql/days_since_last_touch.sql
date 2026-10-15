SELECT 
  {{dimension_select}}
  COALESCE(ROUND(AVG(days_since_last_touch), 1), 0.0) AS avg_days_since_last_touch
FROM rpt.deal_facts
WHERE stage IN ('qualification', 'discover', 'propose', 'negotiate')
  AND days_since_last_touch IS NOT NULL
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
