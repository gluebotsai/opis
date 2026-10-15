SELECT 
  COALESCE(SUM(total), 0)::numeric(15,2) AS collected_revenue,
  COUNT(*)::bigint AS paid_invoice_count
FROM rpt.invoices
WHERE status = 'paid'
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
