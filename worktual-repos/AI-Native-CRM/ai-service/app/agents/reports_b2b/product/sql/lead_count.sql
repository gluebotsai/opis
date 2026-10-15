SELECT
  {{dimension_select}}
  COUNT(*)::bigint AS lead_count
FROM rpt.contacts
WHERE is_active = TRUE
  AND lower(coalesce(contact_type, '')) = 'lead'
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
