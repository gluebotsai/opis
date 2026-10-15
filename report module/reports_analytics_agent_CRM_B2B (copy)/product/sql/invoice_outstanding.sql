SELECT 
  COALESCE(SUM(total), 0)::numeric(15,2) AS outstanding_amount,
  COUNT(*)::bigint AS invoice_count
FROM rpt.invoices
WHERE status IN ('sent', 'overdue')
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
