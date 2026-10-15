SELECT
    {{dimension_select}}
    COALESCE(SUM(r.open_count),0)::bigint AS total_opens

FROM campaign.campaign_send_recipients r
JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
JOIN (
{{base_campaign}}
) campaigns ON campaigns.id = r.campaign_id
WHERE r.organization_id = {{org_id}}
  AND campaigns.branch_id = {{branch_id}}
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}

{{group_by_sql}}
{{limit_sql}}
