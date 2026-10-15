SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS event_submissions
FROM campaign.campaign_form_submissions
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
