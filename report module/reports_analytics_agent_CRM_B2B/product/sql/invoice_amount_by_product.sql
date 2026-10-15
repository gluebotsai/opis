SELECT
  {{dimension_select}}
  COALESCE(il.name, 'Other Products') AS product_name,
  COUNT(DISTINCT il.invoice_id)::bigint AS invoice_count,
  COALESCE(SUM(il.amount), 0)::numeric(15,2) AS invoice_amount
FROM rpt.invoice_lines il
JOIN rpt.invoices inv ON inv.id = il.invoice_id
WHERE inv.status <> 'void'
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
GROUP BY COALESCE(il.name, 'Other Products'){{extra_group_sql}}
ORDER BY invoice_amount DESC
{{limit_sql}}
