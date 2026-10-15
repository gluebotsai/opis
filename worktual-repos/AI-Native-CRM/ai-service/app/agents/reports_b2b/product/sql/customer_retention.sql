SELECT 
  COUNT(*)::bigint AS evaluated_contracts,
  COUNT(*) FILTER (WHERE status = 'active' AND auto_renew = TRUE)::bigint AS retained_contracts,
  CASE 
    WHEN COUNT(*) > 0 THEN ROUND((COUNT(*) FILTER (WHERE status = 'active' AND auto_renew = TRUE)::numeric / COUNT(*)::numeric) * 100.0, 2)
    ELSE 0.00
  END AS retention_rate
FROM rpt.contracts
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
