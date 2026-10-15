SELECT 
  TO_CHAR(close_ts, 'YYYY-MM') AS month,
  COUNT(*)::bigint AS won_deal_count,
  COALESCE(SUM(amount), 0)::numeric(15,2) AS won_revenue
FROM rpt.deals
WHERE is_won = TRUE
  AND close_ts >= (NOW() - INTERVAL '6 months')
  AND {{scope_sql}}
  AND {{filters_sql}}
GROUP BY 1
ORDER BY month ASC
