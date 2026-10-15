SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS regulated_template_status
FROM campaign.regulated_channel_templates
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
