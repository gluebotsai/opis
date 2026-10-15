SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS live_send_pressure
FROM campaign.campaign_send_batches b
JOIN (
{{base_campaign}}
) campaigns ON campaigns.id = b.campaign_id
WHERE b.organization_id = {{org_id}}
  AND {{scope_sql}}
  AND b.status IN ('queued','sending')
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
