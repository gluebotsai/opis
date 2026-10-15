SELECT 
  COALESCE(SUM(amount), 0)::numeric(15,2) AS open_pipeline,
  COALESCE(SUM(weighted_amount), 0)::numeric(15,2) AS weighted_pipeline,
  0.00::numeric(15,2) AS stored_target_quota
FROM rpt.deals
WHERE is_open = TRUE
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
