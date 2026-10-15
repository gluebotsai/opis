SELECT 
  {{dimension_select}}
  COUNT(*) FILTER (WHERE is_won = TRUE)::bigint AS won_count,
  COUNT(*) FILTER (WHERE is_lost = TRUE)::bigint AS lost_count,
  CASE 
    WHEN (COUNT(*) FILTER (WHERE is_won = TRUE) + COUNT(*) FILTER (WHERE is_lost = TRUE)) > 0 
    THEN ROUND((COUNT(*) FILTER (WHERE is_won = TRUE)::numeric / (COUNT(*) FILTER (WHERE is_won = TRUE) + COUNT(*) FILTER (WHERE is_lost = TRUE))::numeric) * 100.0, 2)
    ELSE 0.00
  END AS win_rate
FROM rpt.deals
WHERE (is_won = TRUE OR is_lost = TRUE)
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
