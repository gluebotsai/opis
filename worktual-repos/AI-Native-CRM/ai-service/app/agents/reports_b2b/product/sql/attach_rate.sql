WITH paid_invs AS (
  SELECT 
    id,
    EXISTS (SELECT 1 FROM rpt.invoice_lines il WHERE il.invoice_id = inv.id AND il.kind = 'addon') AS has_addon
  FROM rpt.invoices inv
  WHERE inv.status = 'paid'
    AND {{scope_sql}}
    AND {{time_sql}}
    AND {{filters_sql}}
)
SELECT 
  COUNT(*)::bigint AS paid_invoice_count,
  COUNT(*) FILTER (WHERE has_addon = TRUE)::bigint AS addon_invoice_count,
  CASE 
    WHEN COUNT(*) > 0 THEN ROUND((COUNT(*) FILTER (WHERE has_addon = TRUE)::numeric / COUNT(*)::numeric) * 100.0, 2)
    ELSE 0.00
  END AS attach_rate
FROM paid_invs
