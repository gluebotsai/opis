SELECT
  {{dimension_select}}
  COUNT(*)::bigint AS follow_up_leads
FROM rpt.contacts
WHERE is_active = TRUE
  AND contact_type = 'lead'
  AND needs_followup = TRUE
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
