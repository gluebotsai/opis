SELECT 
  {{dimension_select}}
  COUNT(*)::bigint AS expiring_contracts,
  COALESCE(SUM(arr), 0)::numeric(15,2) AS expiring_arr,
  COUNT(*) FILTER (WHERE renew_deal_id IS NOT NULL)::bigint AS renewed_deals_count
FROM rpt.contracts
WHERE status = 'active'
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
