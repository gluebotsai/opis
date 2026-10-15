SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS channel_readiness
FROM campaign.channel_sending_profiles
WHERE organization_id = {{org_id}}
{{group_by_sql}}
{{limit_sql}}
