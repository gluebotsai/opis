SELECT 
  CASE 
    WHEN amount < 500000 THEN 'Small (< 500k)'
    WHEN amount <= 2500000 THEN 'Mid (500k - 2.5M)'
    ELSE 'Large (> 2.5M)'
  END AS deal_size_band,
  COUNT(*)::bigint AS deal_count,
  COALESCE(SUM(amount), 0)::numeric(15,2) AS total_amount
FROM rpt.deals
WHERE is_open = TRUE
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
GROUP BY 1
ORDER BY MIN(amount) ASC
