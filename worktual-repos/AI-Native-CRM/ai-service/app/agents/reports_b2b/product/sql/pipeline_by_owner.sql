SELECT 
  owner_name,
  COUNT(*)::bigint AS open_deal_count,
  COALESCE(SUM(amount), 0)::numeric(15,2) AS open_pipeline,
  COALESCE(SUM(weighted_amount), 0)::numeric(15,2) AS weighted_pipeline
FROM rpt.deals
WHERE is_open = TRUE
  AND owner_name IS NOT NULL
  AND btrim(owner_name) <> ''
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
GROUP BY owner_name
ORDER BY open_pipeline DESC
LIMIT 10
