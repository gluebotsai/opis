SELECT 
  {{dimension_select}}
  COUNT(*) FILTER (WHERE status = 'accepted')::bigint AS accepted_count,
  COUNT(*) FILTER (WHERE status = 'rejected')::bigint AS rejected_count,
  CASE 
    WHEN COUNT(*) FILTER (WHERE status IN ('accepted', 'rejected')) > 0 
    THEN ROUND((COUNT(*) FILTER (WHERE status = 'accepted')::numeric / COUNT(*) FILTER (WHERE status IN ('accepted', 'rejected'))::numeric) * 100.0, 2)
    ELSE 0.00
  END AS quote_acceptance_rate
FROM rpt.quotes
WHERE status IN ('accepted', 'rejected')
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
