SELECT
  {{dimension_select}}
  lead_status,
  COUNT(*)::bigint AS contact_count
FROM rpt.contacts
WHERE is_active = TRUE
  AND lower(coalesce(contact_type, '')) = 'lead'
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
GROUP BY lead_status{{extra_group_sql}}
ORDER BY contact_count DESC
{{limit_sql}}
