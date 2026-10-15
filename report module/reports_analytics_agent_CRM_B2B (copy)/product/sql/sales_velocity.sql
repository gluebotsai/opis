WITH stats AS (
  SELECT 
    COUNT(*) FILTER (WHERE is_open = TRUE)::numeric AS active_count,
    COALESCE(AVG(amount) FILTER (WHERE is_open = TRUE), 0)::numeric AS avg_deal_size,
    COUNT(*) FILTER (WHERE is_won = TRUE)::numeric AS won_count,
    COUNT(*) FILTER (WHERE is_lost = TRUE)::numeric AS lost_count,
    COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - created_at))/86400) FILTER (WHERE is_won = TRUE AND closed_at > created_at), 0)::numeric AS avg_cycle_days
  FROM rpt.deals
  WHERE {{scope_sql}}
    AND {{time_sql}}
    AND {{filters_sql}}
)
SELECT 
  active_count::bigint AS active_opportunities,
  avg_deal_size::numeric(15,2) AS average_deal_size,
  CASE 
    WHEN (won_count + lost_count) > 0 THEN ROUND((won_count / (won_count + lost_count)) * 100.0, 2)
    ELSE 0.00
  END AS win_rate,
  ROUND(avg_cycle_days, 1) AS avg_cycle_days,
  CASE 
    WHEN (won_count + lost_count) > 0 AND avg_cycle_days > 0 
    THEN ROUND((active_count * (won_count / (won_count + lost_count)) * avg_deal_size) / avg_cycle_days, 2)
    ELSE 0.00
  END AS sales_velocity
FROM stats
