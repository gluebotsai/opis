SELECT
    {{dimension_select}}
    r.contact_id,
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
    CASE WHEN COUNT(*) FILTER (WHERE ((CASE
  WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
  WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
  WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
  WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
    OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
  WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
  WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
  WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
  ELSE 'pending'
END) = 'sent') AND b.channel = 'email') = 0 THEN NULL
    ELSE COUNT(*) FILTER (WHERE ((CASE
  WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
  WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
  WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
  WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
    OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
  WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
  WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
  WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
  ELSE 'pending'
END) = 'sent') AND b.channel = 'email' AND r.opened_at IS NOT NULL)::numeric
         / COUNT(*) FILTER (WHERE ((CASE
  WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
  WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
  WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
  WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
    OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
  WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
  WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
  WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
  ELSE 'pending'
END) = 'sent') AND b.channel = 'email') END AS open_rate,
    CASE WHEN COUNT(*) FILTER (WHERE ((CASE
  WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
  WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
  WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
  WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
    OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
  WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
  WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
  WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
  ELSE 'pending'
END) = 'sent') AND b.channel IN ('email','push','web')) = 0 THEN NULL
    ELSE COUNT(*) FILTER (WHERE ((CASE
  WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
  WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
  WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
  WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
    OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
  WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
  WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
  WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
  ELSE 'pending'
END) = 'sent') AND b.channel IN ('email','push','web') AND r.clicked_at IS NOT NULL)::numeric
         / COUNT(*) FILTER (WHERE ((CASE
  WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
  WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
  WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
  WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
    OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
  WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
  WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
  WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
  ELSE 'pending'
END) = 'sent') AND b.channel IN ('email','push','web')) END AS click_rate

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

GROUP BY r.contact_id{{group_by_tail}}
{{limit_sql}}
