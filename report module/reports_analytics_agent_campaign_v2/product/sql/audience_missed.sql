SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS audience_missed
FROM campaign.campaign_audience a
JOIN (
{{base_campaign}}
) campaigns ON campaigns.id = a.campaign_id
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND NOT EXISTS (
    SELECT 1 FROM campaign.campaign_send_recipients r
    WHERE r.campaign_id = a.campaign_id AND r.contact_id = a.contact_id
      AND r.organization_id = {{org_id}}
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
END = 'sent'
  )
{{group_by_sql}}
{{limit_sql}}
