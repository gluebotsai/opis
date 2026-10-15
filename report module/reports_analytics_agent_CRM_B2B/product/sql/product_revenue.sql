SELECT 
  COALESCE(il.name, 'Other Products') AS product_name,
  COUNT(DISTINCT il.invoice_id)::bigint AS invoice_count,
  COALESCE(SUM(il.amount), 0)::numeric(15,2) AS product_revenue
FROM rpt.invoice_lines il
JOIN rpt.invoices inv ON inv.id = il.invoice_id
WHERE inv.status = 'paid'
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
GROUP BY il.name
ORDER BY product_revenue DESC
