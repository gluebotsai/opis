-- Shared delivery outcome (metrics doc). Used inside rpt.send_recipients source.
CASE
  WHEN lower(coalesce(r.status, '')) IN ('failed', 'cancelled') THEN 'failed'
  WHEN lower(coalesce(r.status, '')) = 'skipped' THEN 'skipped'
  WHEN lower(coalesce(r.status, '')) IN ('stub', 'stub_sent') THEN 'stub'
  WHEN lower(coalesce(r.provider_message_id, '')) LIKE 'stub-%'
    OR lower(coalesce(r.provider_message_id, '')) LIKE 'stub://%' THEN 'stub'
  WHEN lower(coalesce(r.status, '')) IN ('bounced', 'hard_bounce', 'soft_bounce') THEN 'bounce'
  WHEN lower(coalesce(r.skip_fail_reason, '')) LIKE '%bounce%' THEN 'bounce'
  WHEN lower(coalesce(r.status, '')) IN ('sent', 'delivered') THEN 'sent'
  WHEN lower(coalesce(r.status, '')) IN ('pending', 'queued', 'queued_accounts', 'sending', '') THEN 'pending'
  ELSE 'pending'
END
