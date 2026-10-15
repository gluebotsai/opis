CREATE OR REPLACE FUNCTION ccass.prequery_info(p_arg1 text, p_arg2 text, p_domain_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ccass', 'accounts', 'pg_temp'
AS $function$
DECLARE
  v_arg1 text := btrim(coalesce(p_arg1, ''));
  v_arg2 text := btrim(coalesce(p_arg2, ''));
  v_is_outbound boolean;

  v_status int := 0;
  v_agent_name text := '';
  v_email text := '';
  v_user_id text := '';
  v_auto int := 0;
  v_assist int := 0;
  v_human int := 0;
  v_greeting_message text := '';
  v_human_greeting text := '';
  v_rec_in int := 0;
  v_rec_out int := 0;
  v_consent text := '';
  v_agent_did int := 0;
  v_queue_id text := '';
  v_route_agent int := 0;
  v_agent_extn text := '';
  v_agent_email text := '';
  v_agent_userid text := '';
  v_busy int := 0;
  v_ready int := 0;
  v_g_greeting text := '';
  v_g_hold text := '';
  v_g_busy text := '';
  v_g_handoff text := '';
  v_g_unavail text := '';
  v_g_recording text := '';

  v_ddi text;
  v_did accounts.setup_voice_dids%ROWTYPE;
  v_slots jsonb := '[]'::jsonb;
  v_su accounts.setup_users%ROWTYPE;
  v_agent_id bigint;
  v_presence text;
  v_qid bigint;
  v_inbound_enabled boolean;
  v_outbound_enabled boolean;
  v_consent_path text;
BEGIN
  -- Mode: short / non-phone first arg => outbound (agent_extn)
  v_is_outbound := NOT (
    v_arg1 ~ '^\+' OR length(regexp_replace(v_arg1, '\D', '', 'g')) >= 8
  );

  -- Org recording settings (both modes).
  -- Live table has inbound_enabled / outbound_enabled / consent_prompt_id — no consent_prompt_path.
  SELECT
    coalesce(r.inbound_enabled, false),
    coalesce(r.outbound_enabled, false)
  INTO v_inbound_enabled, v_outbound_enabled
  FROM accounts.setup_organization_recording_settings r
  WHERE r.organization_id = p_domain_id;

  v_consent_path := '';

  IF coalesce(v_inbound_enabled, false) THEN v_rec_in := 1; END IF;
  IF coalesce(v_outbound_enabled, false) THEN v_rec_out := 1; END IF;
  IF v_rec_in = 1 OR v_rec_out = 1 THEN
    v_consent := coalesce(v_consent_path, '');
  END IF;

  --------------------------------------------------------------------------
  -- OUTBOUND: (agent_extn, customer_no, domainId)
  --------------------------------------------------------------------------
  IF v_is_outbound THEN
    v_status := 1;

    SELECT * INTO v_su
    FROM accounts.setup_users su
    WHERE su.organization_id = p_domain_id
      AND su.ext::text = v_arg1
    LIMIT 1;

    IF FOUND THEN
      v_agent_name := btrim(coalesce(v_su.first_name, '') || ' ' || coalesce(v_su.last_name, ''));
      v_email := coalesce(v_su.work_email, '');
      v_user_id := v_su.id::text;
    END IF;

    RETURN jsonb_build_object(
      'status', v_status,
      'cli_block', 0,
      'firstName', '',
      'lastName', '',
      'agent_name', coalesce(v_agent_name, ''),
      'email', coalesce(v_email, ''),
      'userId', coalesce(v_user_id, ''),
      'autoAttendant', 0,
      'assistPriority', 0,
      'greetingMessage', '',
      'humanAgent', 0,
      'humanAgentgreeting', '',
      'recording', jsonb_build_object(
        'voiceUrl', coalesce(v_g_recording, ''),
        'callRecordingMessage', coalesce(v_g_recording, ''),
        'isInbound', v_rec_in,
        'isOutbound', v_rec_out
      ),
      'agent_did', 0,
      'queueId', '',
      'is_route_to_agent', 0,
      'agent_extn', '',
      'agent_email', '',
      'agent_userid', '',
      'agent_busy', 0,
      'agent_ready', 0,
      'greeting', jsonb_build_object(
        'greetingAudio', '',
        'holdAudio', '',
        'agentBusyMessage', '',
        'agentHandOffMessage', '',
        'agentUnavaiblaeAnnoucement', '',
        'callRecordingMessage', ''
      )
    );
  END IF;

  --------------------------------------------------------------------------
  -- INBOUND: (cli, ddi, domainId)
  --------------------------------------------------------------------------
  v_ddi := regexp_replace(v_arg2, '^\+', '');

  SELECT * INTO v_did
  FROM accounts.setup_voice_dids d
  WHERE d.organization_id = p_domain_id
    AND regexp_replace(btrim(d.phone_number), '^\+', '') = v_ddi
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 0,
      'cli_block', 0,
      'firstName', '',
      'lastName', '',
      'agent_name', '',
      'email', '',
      'userId', '',
      'autoAttendant', 0,
      'assistPriority', 0,
      'greetingMessage', '',
      'humanAgent', 0,
      'humanAgentgreeting', '',
      'recording', jsonb_build_object(
        'voiceUrl', coalesce(v_g_recording, ''),
        'callRecordingMessage', coalesce(v_g_recording, ''),
        'isInbound', v_rec_in,
        'isOutbound', v_rec_out
      ),
      'agent_did', 0,
      'queueId', '',
      'is_route_to_agent', 0,
      'agent_extn', '',
      'agent_email', '',
      'agent_userid', '',
      'agent_busy', 0,
      'agent_ready', 0,
      'greeting', jsonb_build_object(
        'greetingAudio', '',
        'holdAudio', '',
        'agentBusyMessage', '',
        'agentHandOffMessage', '',
        'agentUnavaiblaeAnnoucement', '',
        'callRecordingMessage', ''
      )
    );
  END IF;

  IF v_did.status = 'active' THEN
    v_status := 1;
  ELSE
    v_status := 0;
  END IF;

  IF v_did.handling_type = 'auto_attendant' THEN v_auto := 1; END IF;
  IF v_did.handling_type = 'virtual_agent' THEN v_assist := 1; END IF;
  IF v_did.handling_type = 'human_agent' THEN v_human := 1; END IF;

  IF coalesce(v_did.is_route_to_agent, false) THEN v_route_agent := 1; END IF;
  IF v_did.routing_queue_id IS NOT NULL THEN
    v_queue_id := v_did.routing_queue_id::text;
    v_qid := v_did.routing_queue_id;
  END IF;

  -- Direct agent map
  IF v_did.routing_user_id IS NOT NULL THEN
    v_agent_did := 1;
    v_human := 0;
    v_human_greeting := '';

    SELECT * INTO v_su
    FROM accounts.setup_users su
    WHERE su.id = v_did.routing_user_id
      AND su.organization_id = p_domain_id;

    IF FOUND THEN
      v_agent_name := btrim(coalesce(v_su.first_name, '') || ' ' || coalesce(v_su.last_name, ''));
      v_email := coalesce(v_su.work_email, '');
      v_user_id := v_su.id::text;
      v_agent_extn := coalesce(v_su.ext::text, '');
      v_agent_email := coalesce(v_su.work_email, '');
      v_agent_userid := v_su.id::text;

      SELECT a.id INTO v_agent_id
      FROM ccass.agents a
      WHERE a.setup_user_id = v_su.id
        AND a.organization_id = p_domain_id
      LIMIT 1;

      IF v_agent_id IS NOT NULL THEN
        SELECT ap.presence_state INTO v_presence
        FROM ccass.agent_presence ap
        WHERE ap.agent_id = v_agent_id;

        IF v_presence = 'busy' THEN v_busy := 1; END IF;
        IF v_presence = 'ready' THEN v_ready := 1; END IF;
      END IF;
    END IF;
  END IF;

  -- Number Prompt Library (for greetingMessage / humanAgentgreeting paths)
  IF v_did.prompt_profile_id IS NOT NULL THEN
    SELECT coalesce(p.slots, '[]'::jsonb) INTO v_slots
    FROM accounts.setup_voice_prompt_profiles p
    WHERE p.id = v_did.prompt_profile_id
      AND p.organization_id = p_domain_id;
  END IF;

  IF v_auto = 1 THEN
    v_greeting_message := coalesce(
      (SELECT coalesce(nullif(s->>'audioPath', ''), nullif(s->>'audioKey', ''), '')
       FROM jsonb_array_elements(coalesce(v_slots, '[]'::jsonb)) s
       WHERE s->>'id' = 'welcome_greeting' LIMIT 1),
      ''
    );
  END IF;

  IF v_human = 1 AND v_agent_did = 0 THEN
    v_human_greeting := coalesce(
      (SELECT coalesce(nullif(s->>'audioPath', ''), nullif(s->>'audioKey', ''), '')
       FROM jsonb_array_elements(coalesce(v_slots, '[]'::jsonb)) s
       WHERE s->>'id' = 'agent_available' LIMIT 1),
      ''
    );
  END IF;

  -- Queue-based greeting.* (empty when autoAttendant=1 or no queue)
  IF v_auto = 0 AND v_qid IS NOT NULL THEN
    SELECT coalesce(audio_path, '') INTO v_g_greeting
    FROM accounts.setup_ccaas_queue_prompt_slots
    WHERE queue_id = v_qid AND slot_id = 'queue_greeting' LIMIT 1;

    SELECT coalesce(audio_path, '') INTO v_g_hold
    FROM accounts.setup_ccaas_queue_prompt_slots
    WHERE queue_id = v_qid AND slot_id = 'hold_audio' LIMIT 1;

    SELECT coalesce(audio_path, '') INTO v_g_busy
    FROM accounts.setup_ccaas_queue_prompt_slots
    WHERE queue_id = v_qid AND slot_id = 'agent_busy' LIMIT 1;
    IF coalesce(v_g_busy, '') = '' THEN
      v_g_busy := coalesce(
        (SELECT coalesce(nullif(s->>'audioPath', ''), nullif(s->>'audioKey', ''), '')
         FROM jsonb_array_elements(coalesce(v_slots, '[]'::jsonb)) s
         WHERE s->>'id' = 'agent_busy' LIMIT 1), '');
    END IF;

    SELECT coalesce(audio_path, '') INTO v_g_handoff
    FROM accounts.setup_ccaas_queue_prompt_slots
    WHERE queue_id = v_qid AND slot_id = 'agent_available' LIMIT 1;
    IF coalesce(v_g_handoff, '') = '' THEN
      v_g_handoff := coalesce(
        (SELECT coalesce(nullif(s->>'audioPath', ''), nullif(s->>'audioKey', ''), '')
         FROM jsonb_array_elements(coalesce(v_slots, '[]'::jsonb)) s
         WHERE s->>'id' = 'agent_available' LIMIT 1), '');
    END IF;

    SELECT coalesce(audio_path, '') INTO v_g_unavail
    FROM accounts.setup_ccaas_queue_prompt_slots
    WHERE queue_id = v_qid AND slot_id = 'agent_unavailable' LIMIT 1;
    IF coalesce(v_g_unavail, '') = '' THEN
      v_g_unavail := coalesce(
        (SELECT coalesce(nullif(s->>'audioPath', ''), nullif(s->>'audioKey', ''), '')
         FROM jsonb_array_elements(coalesce(v_slots, '[]'::jsonb)) s
         WHERE s->>'id' = 'agent_unavailable' LIMIT 1), '');
    END IF;

    SELECT coalesce(audio_path, '') INTO v_g_recording
    FROM accounts.setup_ccaas_queue_prompt_slots
    WHERE queue_id = v_qid AND slot_id = 'call_recording_message' LIMIT 1;
    IF coalesce(v_g_recording, '') = '' THEN
      v_g_recording := coalesce(
        (SELECT coalesce(nullif(s->>'audioPath', ''), nullif(s->>'audioKey', ''), '')
         FROM jsonb_array_elements(coalesce(v_slots, '[]'::jsonb)) s
         WHERE s->>'id' = 'call_recording_message' LIMIT 1), '');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'cli_block', 0,
    'firstName', '',
    'lastName', '',
    'agent_name', coalesce(v_agent_name, ''),
    'email', coalesce(v_email, ''),
    'userId', coalesce(v_user_id, ''),
    'autoAttendant', v_auto,
    'assistPriority', v_assist,
    'greetingMessage', coalesce(v_greeting_message, ''),
    'humanAgent', v_human,
    'humanAgentgreeting', coalesce(v_human_greeting, ''),
    'recording', jsonb_build_object(
      'voiceUrl', coalesce(v_g_recording, ''),
      'callRecordingMessage', coalesce(v_g_recording, ''),
      'isInbound', v_rec_in,
      'isOutbound', v_rec_out
    ),
    'agent_did', v_agent_did,
    'queueId', coalesce(v_queue_id, ''),
    'is_route_to_agent', v_route_agent,
    'agent_extn', coalesce(v_agent_extn, ''),
    'agent_email', coalesce(v_agent_email, ''),
    'agent_userid', coalesce(v_agent_userid, ''),
    'agent_busy', v_busy,
    'agent_ready', v_ready,
    'greeting', jsonb_build_object(
      'greetingAudio', coalesce(v_g_greeting, ''),
      'holdAudio', coalesce(v_g_hold, ''),
      'agentBusyMessage', coalesce(v_g_busy, ''),
      'agentHandOffMessage', coalesce(v_g_handoff, ''),
      'agentUnavaiblaeAnnoucement', coalesce(v_g_unavail, ''),
      'callRecordingMessage', coalesce(v_g_recording, '')
    )
  );
END;
$function$;
