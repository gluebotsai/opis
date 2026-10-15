SELECT
    {{dimension_select}}
    COALESCE(SUM(used_count),0)::bigint AS library_ops
FROM campaign.campaign_library_templates
WHERE organization_id = {{org_id}}
{{group_by_sql}}
{{limit_sql}}
