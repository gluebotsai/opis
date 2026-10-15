SELECT
    {{dimension_select}}
    COUNT(*) FILTER (WHERE ((CASE
  WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
  WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
  WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
  WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
    OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
  WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
  WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
  WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
  ELSE 'pending'
END) = 'sent'))::bigint AS messages_delivered

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

  AND ((CASE
  WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
  WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
  WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
  WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
    OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
  WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
  WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
  WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
  ELSE 'pending'
END) = 'sent')
{{group_by_sql}}
{{limit_sql}}
