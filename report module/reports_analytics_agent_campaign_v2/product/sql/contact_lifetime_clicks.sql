SELECT
    {{dimension_select}}
    COALESCE(SUM(email_click_count),0)::bigint AS contact_lifetime_clicks
FROM campaign.campaign_contact_engagement
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
