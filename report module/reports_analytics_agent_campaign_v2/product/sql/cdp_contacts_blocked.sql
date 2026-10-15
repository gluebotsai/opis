SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS cdp_contacts_blocked
FROM cdp.customer_profile
WHERE organization_id = {{org_id}}
  AND blocked = true
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
