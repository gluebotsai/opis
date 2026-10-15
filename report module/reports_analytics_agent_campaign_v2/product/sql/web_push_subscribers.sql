SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS web_push_subscribers
FROM campaign.website_contacts
WHERE organization_id = {{org_id}}
  AND subscribed = true
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
