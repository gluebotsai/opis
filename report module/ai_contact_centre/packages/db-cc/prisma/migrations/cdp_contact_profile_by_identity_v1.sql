-- Find one CDP contact from any identity and return the whole profile.
-- Email, phone, WhatsApp, Instagram, Facebook, webchat, or any other identity key.
-- Phone match allows a missing or present country code (91, 1, 44), +, 00, and a UK trunk 0.
-- Call: SELECT * FROM cdp.get_contact_profile_by_identity(1012, '919150911820');

CREATE OR REPLACE FUNCTION cdp.identity_phone_matches(p_left text, p_right text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  WITH left_raw AS (
    SELECT CASE
      WHEN digits LIKE '00%' THEN substring(digits FROM 3)
      ELSE digits
    END AS digits
    FROM (
      SELECT regexp_replace(COALESCE(p_left, ''), '\D', '', 'g') AS digits
    ) stripped
  ),
  right_raw AS (
    SELECT CASE
      WHEN digits LIKE '00%' THEN substring(digits FROM 3)
      ELSE digits
    END AS digits
    FROM (
      SELECT regexp_replace(COALESCE(p_right, ''), '\D', '', 'g') AS digits
    ) stripped
  ),
  left_forms AS (
    SELECT digits AS form FROM left_raw WHERE digits <> ''
    UNION
    SELECT substring(digits FROM 2)
    FROM left_raw
    WHERE digits LIKE '0%' AND length(digits) > 1
  ),
  right_forms AS (
    SELECT digits AS form FROM right_raw WHERE digits <> ''
    UNION
    SELECT substring(digits FROM 2)
    FROM right_raw
    WHERE digits LIKE '0%' AND length(digits) > 1
  )
  SELECT EXISTS (
    SELECT 1
    FROM left_forms l
    JOIN right_forms r ON TRUE
    WHERE l.form = r.form
       OR (
         LEAST(length(l.form), length(r.form)) >= 10
         AND ABS(length(l.form) - length(r.form)) BETWEEN 1 AND 3
         AND CASE
           WHEN length(l.form) > length(r.form) THEN l.form LIKE '%' || r.form
           ELSE r.form LIKE '%' || l.form
         END
       )
  );
$$;

CREATE OR REPLACE FUNCTION cdp.get_contact_profile_by_identity(
  p_organization_id bigint,
  p_identity text
)
RETURNS TABLE (
  cdp_id text,
  organization_id bigint,
  matched_key_type text,
  matched_key_value text,
  customer_profile jsonb,
  identity_keys jsonb
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_identity text;
BEGIN
  v_identity := btrim(COALESCE(p_identity, ''));

  IF p_organization_id IS NULL OR v_identity = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      cp.cdp_id,
      cp.organization_id AS profile_organization_id,
      cp.updated_at,
      CASE
        WHEN cp.cdp_id = v_identity THEN 0
        WHEN btrim(ik.key_value) = v_identity THEN 1
        WHEN lower(btrim(ik.key_value)) = lower(v_identity) THEN 2
        ELSE 3
      END AS match_rank,
      COALESCE(ik.key_type, 'cdp_id') AS matched_type,
      COALESCE(ik.key_value, cp.cdp_id) AS matched_value,
      to_jsonb(cp) AS profile_json
    FROM cdp.customer_profile cp
    LEFT JOIN cdp.identity_keys ik
      ON ik.organization_id = cp.organization_id
     AND ik.cdp_id = cp.cdp_id
    WHERE cp.organization_id = p_organization_id
      AND (
        cp.cdp_id = v_identity
        OR btrim(ik.key_value) = v_identity
        OR lower(btrim(ik.key_value)) = lower(v_identity)
        OR (
          ik.key_type IN ('phone', 'phone_secondary', 'whatsapp_phone')
          AND cdp.identity_phone_matches(v_identity, ik.key_value)
        )
      )
  ),
  winner AS (
    SELECT *
    FROM candidates
    ORDER BY match_rank ASC, updated_at DESC NULLS LAST
    LIMIT 1
  )
  SELECT
    winner.cdp_id::text,
    winner.profile_organization_id,
    winner.matched_type::text,
    winner.matched_value::text,
    winner.profile_json,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'key_type', keys.key_type,
          'key_value', keys.key_value,
          'source_system', keys.source_system,
          'verified', keys.verified
        )
        ORDER BY keys.key_type, keys.created_at
      )
      FROM cdp.identity_keys keys
      WHERE keys.organization_id = winner.profile_organization_id
        AND keys.cdp_id = winner.cdp_id
    ), '[]'::jsonb)
  FROM winner;
END;
$$;
