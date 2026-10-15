SELECT 
  {{dimension_select}}
  COUNT(*)::bigint AS pending_approval_invoices
FROM rpt.invoices
WHERE approval_status = 'pending_approval'
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
