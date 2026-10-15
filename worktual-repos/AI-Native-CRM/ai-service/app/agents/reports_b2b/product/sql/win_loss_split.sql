SELECT 
  {{dimension_select}}
  COUNT(*) FILTER (WHERE is_won = TRUE)::bigint AS won_count,
  COALESCE(SUM(amount) FILTER (WHERE is_won = TRUE), 0)::numeric(15,2) AS won_amount,
  COUNT(*) FILTER (WHERE is_lost = TRUE)::bigint AS lost_count,
  COALESCE(SUM(amount) FILTER (WHERE is_lost = TRUE), 0)::numeric(15,2) AS lost_amount
FROM rpt.deals
WHERE (is_won = TRUE OR is_lost = TRUE)
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
