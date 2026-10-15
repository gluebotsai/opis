SELECT 
  COALESCE(SUM(total), 0)::numeric(15,2) AS overdue_amount,
  COUNT(*)::bigint AS overdue_invoice_count
FROM rpt.invoices
WHERE is_overdue = TRUE
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
