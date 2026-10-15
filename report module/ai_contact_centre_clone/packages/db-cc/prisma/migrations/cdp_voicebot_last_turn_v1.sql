-- Last voicebot turn for one call: the latest customer line and the bot reply after it.
-- Live-agent lines are skipped. The mobile may include a country code or not.
-- Call: SELECT * FROM cdp.get_voicebot_last_turn(1012, '7904812618', '<session id>');

CREATE OR REPLACE FUNCTION cdp.get_voicebot_last_turn(
  p_organization_id bigint,
  p_mobile text,
  p_session_id text
)
RETURNS TABLE (
  conversation_id text,
  session_id text,
  messages jsonb
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_mobile text;
  v_session text;
  v_uuid text;
  v_conversation_id bigint;
  v_session_id text;
  v_last_sender text;
  v_last_body text;
  v_last_at timestamptz;
  v_last_id bigint;
  v_user_body text;
  v_user_at timestamptz;
BEGIN
  v_mobile := btrim(COALESCE(p_mobile, ''));
  v_session := btrim(COALESCE(p_session_id, ''));
  v_uuid := substring(
    lower(v_session)
    from '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
  );

  IF p_organization_id IS NULL OR v_mobile = '' OR v_session = '' THEN
    RETURN;
  END IF;

  SELECT c.id, COALESCE(c.provider_thread_id, c.external_thread_id)
  INTO v_conversation_id, v_session_id
  FROM ccass.conversations c
  WHERE c.organization_id = p_organization_id
    AND c.channel IN ('call', 'voice', 'phone')
    AND (
      c.external_thread_id = v_session
      OR c.provider_thread_id = v_session
      OR (
        v_uuid IS NOT NULL
        AND (
          lower(COALESCE(c.external_thread_id, '')) LIKE '%' || v_uuid
          OR lower(COALESCE(c.provider_thread_id, '')) LIKE '%' || v_uuid
        )
      )
    )
    AND (
      cdp.identity_phone_matches(c.visitor_id, v_mobile)
      OR EXISTS (
        SELECT 1
        FROM cdp.identity_keys ik
        WHERE ik.organization_id = c.organization_id
          AND ik.cdp_id = c.contact_id
          AND ik.key_type IN ('phone', 'phone_secondary', 'whatsapp_phone')
          AND cdp.identity_phone_matches(ik.key_value, v_mobile)
      )
    )
  ORDER BY c.updated_at DESC
  LIMIT 1;

  IF v_conversation_id IS NULL THEN
    RETURN;
  END IF;

  SELECT m.sender_type, btrim(m.body), m.created_at, m.id
  INTO v_last_sender, v_last_body, v_last_at, v_last_id
  FROM ccass.conversation_messages m
  WHERE m.organization_id = p_organization_id
    AND m.conversation_id = v_conversation_id
    AND m.sender_type IN ('customer', 'bot')
    AND m.visibility = 'customer'
    AND btrim(COALESCE(m.body, '')) <> ''
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1;

  IF v_last_sender IS NULL THEN
    RETURN;
  END IF;

  conversation_id := v_conversation_id::text;
  session_id := v_session_id;

  IF v_last_sender = 'customer' THEN
    messages := jsonb_build_array(
      jsonb_build_object(
        'role', 'user',
        'message', v_last_body,
        'at', v_last_at
      )
    );
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT btrim(m.body), m.created_at
  INTO v_user_body, v_user_at
  FROM ccass.conversation_messages m
  WHERE m.organization_id = p_organization_id
    AND m.conversation_id = v_conversation_id
    AND m.sender_type = 'customer'
    AND m.visibility = 'customer'
    AND btrim(COALESCE(m.body, '')) <> ''
    AND (m.created_at, m.id) < (v_last_at, v_last_id)
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1;

  IF v_user_body IS NULL THEN
    messages := jsonb_build_array(
      jsonb_build_object(
        'role', 'assistant',
        'message', v_last_body,
        'at', v_last_at
      )
    );
  ELSE
    messages := jsonb_build_array(
      jsonb_build_object(
        'role', 'user',
        'message', v_user_body,
        'at', v_user_at
      ),
      jsonb_build_object(
        'role', 'assistant',
        'message', v_last_body,
        'at', v_last_at
      )
    );
  END IF;

  RETURN NEXT;
END;
$$;
