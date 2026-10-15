SELECT
    {{dimension_select}}
    COUNT(DISTINCT r.contact_id)::bigint AS contacts_engaged

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

  AND (r.opened_at IS NOT NULL OR r.clicked_at IS NOT NULL)
{{group_by_sql}}
{{limit_sql}}
