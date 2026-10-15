SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS website_visitor_count
FROM campaign.website_contacts
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
