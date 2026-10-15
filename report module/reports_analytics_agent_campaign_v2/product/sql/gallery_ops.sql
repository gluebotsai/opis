SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS gallery_ops
FROM campaign.campaign_gallery_jobs
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
