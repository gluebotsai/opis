SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS unsubscribes
FROM campaign.campaign_contact_engagement
WHERE organization_id = {{org_id}}
  AND email_unsubscribed = true
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
