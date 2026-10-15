SELECT 
  title,
  company_name,
  owner_name,
  stage,
  amount,
  currency_code,
  aging_days,
  expected_close_date
FROM rpt.deals
WHERE is_open = TRUE
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
ORDER BY amount DESC
LIMIT 10
