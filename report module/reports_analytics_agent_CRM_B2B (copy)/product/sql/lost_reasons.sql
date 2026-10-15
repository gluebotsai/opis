SELECT 
  COALESCE(lost_reason, 'Unspecified') AS lost_reason,
  COUNT(*)::bigint AS deal_count,
  COALESCE(SUM(amount), 0)::numeric(15,2) AS lost_amount
FROM rpt.deals
WHERE is_lost = TRUE
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
GROUP BY lost_reason
ORDER BY deal_count DESC
LIMIT 8
