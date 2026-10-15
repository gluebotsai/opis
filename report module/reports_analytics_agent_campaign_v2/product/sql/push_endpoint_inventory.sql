SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS push_endpoint_inventory
FROM campaign.push_endpoints
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
