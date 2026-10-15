SELECT 
  CASE 
    WHEN aging_days <= 30 THEN '0-30 days'
    WHEN aging_days <= 60 THEN '31-60 days'
    WHEN aging_days <= 90 THEN '61-90 days'
    ELSE '91+ days'
  END AS aging_band,
  COUNT(*)::bigint AS deal_count,
  COALESCE(SUM(amount), 0)::numeric(15,2) AS total_amount
FROM rpt.deals
WHERE is_open = TRUE
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
GROUP BY 1
ORDER BY MIN(aging_days) ASC
