SELECT 
  {{dimension_select}}
  COUNT(*)::bigint AS unassigned_leads
FROM rpt.contacts
WHERE is_active = TRUE
  AND owner_user_id IS NULL
  AND lead_status NOT IN ('converted', 'disqualified')
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{order_by_sql}}
{{limit_sql}}
