SELECT 
  {{dimension_select}}
  COUNT(*)::bigint AS active_contracts,
  COALESCE(SUM(arr), 0)::numeric(15,2) AS total_contract_arr
FROM rpt.contracts
WHERE status = 'active'
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
