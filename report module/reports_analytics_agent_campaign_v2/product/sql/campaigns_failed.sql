SELECT
    {{dimension_select}}
    COUNT(DISTINCT campaigns.id)::bigint AS campaigns_failed

FROM (
{{base_campaign}}
) campaigns
{{channel_join}}
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{ppc_exclude_sql}}
  AND {{filters_sql}}

  AND campaigns.status IN ('live','completed','cancelled')
  AND EXISTS (
    SELECT 1 FROM campaign.campaign_send_recipients r
    WHERE r.campaign_id = campaigns.id AND r.organization_id = {{org_id}}
      AND CASE
  WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
  WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
  WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
  WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
    OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
  WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
  WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
  WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
  ELSE 'pending'
END = 'failed'
  )
{{group_by_sql}}
{{limit_sql}}
