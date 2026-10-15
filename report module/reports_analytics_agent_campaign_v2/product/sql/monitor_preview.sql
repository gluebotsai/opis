SELECT
    {{dimension_select}}
    campaigns.id AS campaign_id,
    MAX(campaigns.name) AS campaign_name,
    MAX(campaigns.audience_count) AS targeted,
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
END) = 'sent'))::bigint AS delivered,
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
END) = 'sent') AND r.opened_at IS NOT NULL)::bigint AS opened,
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
END) = 'sent') AND r.clicked_at IS NOT NULL)::bigint AS clicked

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

  AND campaigns.status IN ('live','completed','cancelled')
GROUP BY campaigns.id{{group_by_tail}}
{{limit_sql}}
