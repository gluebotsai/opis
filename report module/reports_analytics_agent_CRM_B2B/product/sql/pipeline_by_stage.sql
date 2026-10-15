SELECT 
  stage,
  COUNT(*)::bigint AS deal_count,
  COALESCE(SUM(amount), 0)::numeric(15,2) AS stage_amount,
  COALESCE(SUM(weighted_amount), 0)::numeric(15,2) AS weighted_amount
FROM rpt.deals
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
GROUP BY stage
ORDER BY 
  CASE stage 
    WHEN 'qualification' THEN 1 
    WHEN 'discover' THEN 2 
    WHEN 'propose' THEN 3 
    WHEN 'negotiate' THEN 4 
    WHEN 'closed_won' THEN 5 
    WHEN 'closed_lost' THEN 6 
    ELSE 7 
  END
