-- Look up one contact's omni-channel summary by organization and mobile number.
-- A leading + is ignored on both the argument and the stored phone, so
-- +918778828184 and 918778828184 match.
-- Call: SELECT * FROM cdp.get_omni_channel_summary_by_mobile(1012, '+918778828184');

CREATE OR REPLACE FUNCTION cdp.get_omni_channel_summary_by_mobile(
  p_organization_id bigint,
  p_mobile text
)
RETURNS TABLE (
  cdp_id text,
  organization_id bigint,
  mobile text,
  omni_channel_summary text,
  omni_channel_summary_updated_at text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_mobile text;
BEGIN
  v_mobile := regexp_replace(ltrim(btrim(COALESCE(p_mobile, '')), '+'), '\s+', '', 'g');

  IF p_organization_id IS NULL OR v_mobile = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    cp.cdp_id::text,
    cp.organization_id,
    ph.key_value::text AS mobile,
    NULLIF(btrim(cp.custom_fields ->> 'omniChannelSummary'), '') AS omni_channel_summary,
    NULLIF(btrim(cp.custom_fields ->> 'omniChannelSummaryUpdatedAt'), '') AS omni_channel_summary_updated_at
  FROM cdp.identity_keys ik
  JOIN cdp.customer_profile cp
    ON cp.cdp_id = ik.cdp_id
   AND cp.organization_id = ik.organization_id
  LEFT JOIN LATERAL (
    SELECT key_value
    FROM cdp.identity_keys phone_key
    WHERE phone_key.organization_id = cp.organization_id
      AND phone_key.cdp_id = cp.cdp_id
      AND phone_key.key_type IN ('phone', 'whatsapp_phone', 'phone_secondary')
    ORDER BY CASE phone_key.key_type
      WHEN 'phone' THEN 1
      WHEN 'whatsapp_phone' THEN 2
      ELSE 3
    END
    LIMIT 1
  ) ph ON TRUE
  WHERE ik.organization_id = p_organization_id
    AND ik.key_type IN ('phone', 'whatsapp_phone', 'phone_secondary')
    AND regexp_replace(ltrim(btrim(ik.key_value), '+'), '\s+', '', 'g') = v_mobile
  ORDER BY cp.updated_at DESC NULLS LAST
  LIMIT 1;
END;
$$;
