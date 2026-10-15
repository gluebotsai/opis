SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS contact_push_reachability
FROM campaign.push_endpoints
WHERE organization_id = {{org_id}}
  AND active = true
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
