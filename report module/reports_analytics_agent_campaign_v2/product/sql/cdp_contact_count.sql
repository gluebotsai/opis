SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS cdp_contact_count
FROM cdp.customer_profile
WHERE organization_id = {{org_id}}
  AND coalesce(custom_fields->>'campaign_deleted','') <> 'true'
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
