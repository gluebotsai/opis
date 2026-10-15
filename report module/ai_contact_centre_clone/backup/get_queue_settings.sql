CREATE OR REPLACE FUNCTION ccass.get_queue_settings(p_queue_id text, p_domain_id text, p_customer_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ccass', 'accounts', 'pg_temp'
AS $function$
DECLARE
  v_qid bigint;
  v_org bigint;
  v_queue accounts.setup_ccaas_queues%ROWTYPE;

  v_bh_id bigint;
  v_tz text := 'UTC';
  v_holiday_cal bigint;
  v_working_days jsonb;
  v_day_timings jsonb := '{}'::jsonb;
  v_day_entry jsonb;
  v_open_txt text;
  v_close_txt text;
  v_open_time time;
  v_close_time time;
  v_local_ts timestamp;
  v_local_date date;
  v_local_time time;
  v_day_name text;
  v_hours int := 0;
  v_is_holiday boolean := false;
  v_in_hours boolean := false;
  v_holiday_path text := '';

  v_agent_count int := 0;
  v_busy_agents int := 0;
  v_callers_waiting int := 0;
  v_total_numbers int := 0;
  v_queue_limit int := 0;

  v_ann_type int := 1;
  v_ann_tts text := '';
  v_ann_path text := '';

  v_connecting text := '';
  v_greeting text := '';
  v_queue_audio text := '';
  v_hold text := '';
  v_recording int := 0;

  v_max_wait int := 0;
BEGIN
  BEGIN
    v_qid := nullif(btrim(coalesce(p_queue_id, '')), '')::bigint;
    v_org := nullif(btrim(coalesce(p_domain_id, '')), '')::bigint;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('queueSettings', jsonb_build_object());
  END;

  IF v_qid IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('queueSettings', jsonb_build_object());
  END IF;

  SELECT *
    INTO v_queue
  FROM accounts.setup_ccaas_queues q
  WHERE q.id = v_qid
    AND q.organization_id = v_org
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('queueSettings', jsonb_build_object());
  END IF;

  -- Announcement type + TTS / path
  IF v_queue.announcement_slot_id = 'maximum_wait_time_announcement' THEN
    v_ann_type := 2;
    v_ann_tts := 'Your call will be handled in approximately $waiting_minutes$. Thank you for waiting.';
    v_ann_path := '';
  ELSIF v_queue.announcement_slot_id = 'queue_announcement' THEN
    v_ann_type := 3;
    v_ann_tts := '';
    v_ann_path := coalesce(v_queue.announcement_audio_path, '');
  ELSE
    v_ann_type := 1;
    v_ann_tts := 'Your call is $waiting_position$ position in the queue and will be attended shortly. Thank you for waiting.';
    v_ann_path := '';
  END IF;

  -- Queue audio slots
  SELECT
    coalesce(max(CASE WHEN s.slot_id = 'connecting_audio' THEN s.audio_path END), ''),
    coalesce(max(CASE WHEN s.slot_id = 'queue_greeting' THEN s.audio_path END), ''),
    coalesce(max(CASE WHEN s.slot_id = 'queue_audio' THEN s.audio_path END), ''),
    coalesce(max(CASE WHEN s.slot_id = 'hold_audio' THEN s.audio_path END), '')
  INTO v_connecting, v_greeting, v_queue_audio, v_hold
  FROM accounts.setup_ccaas_queue_prompt_slots s
  WHERE s.queue_id = v_qid;

  -- Org recording flag
  IF to_regclass('accounts.setup_organization_recording_settings') IS NOT NULL THEN
    SELECT CASE
             WHEN coalesce(r.inbound_enabled, false) OR coalesce(r.outbound_enabled, false)
             THEN 1 ELSE 0
           END
      INTO v_recording
    FROM accounts.setup_organization_recording_settings r
    WHERE r.organization_id = v_org
    LIMIT 1;
    v_recording := coalesce(v_recording, 0);
  END IF;

  -- Agent counts: non-offline for agentCount; busy for capacity
  SELECT
    count(*) FILTER (
      WHERE lower(coalesce(ap.presence_state, 'offline')) <> 'offline'
    )::int,
    count(*) FILTER (
      WHERE lower(coalesce(ap.presence_state, '')) = 'busy'
    )::int
  INTO v_agent_count, v_busy_agents
  FROM accounts.setup_ccaas_queue_agents qa
  JOIN ccass.agents a
    ON a.setup_user_id = qa.user_id
   AND a.organization_id = v_org
  LEFT JOIN ccass.agent_presence ap
    ON ap.agent_id = a.id
  WHERE qa.queue_id = v_qid;

  v_agent_count := coalesce(v_agent_count, 0);
  v_busy_agents := coalesce(v_busy_agents, 0);

  -- Callers waiting in this queue
  SELECT coalesce(jsonb_array_length(l.queue_list), 0)
    INTO v_callers_waiting
  FROM ccass.live_call_queue_members_details l
  WHERE l.queue_id = v_qid
  LIMIT 1;
  v_callers_waiting := coalesce(v_callers_waiting, 0);

  -- Entitled total numbers (live CCaaS subscription)
  SELECT coalesce(s.total_number_count, 0)
    INTO v_total_numbers
  FROM accounts.subscriptions s
  WHERE s.organization_id = v_org
    AND s.product_id = 'contact-center'
    AND s.cancelled_at IS NULL
    AND coalesce(s.status, 'active') NOT IN ('cancelled', 'expired')
  ORDER BY s.id DESC
  LIMIT 1;
  v_total_numbers := coalesce(v_total_numbers, 0);

  v_queue_limit := greatest(v_total_numbers - v_busy_agents - v_callers_waiting, 0);

  IF v_queue.max_wait_mode = 'limited' THEN
    v_max_wait := coalesce(v_queue.max_wait_minutes, 0);
  ELSE
    v_max_wait := 0;
  END IF;

  -- Business hours for this organization.
  -- Prefer the team link. If that row has no day_timings, use the hours row
  -- whose id equals the queue team_id (the lookup that holds the live JSON).
  -- hoursOfOperation: 2 = holiday, 1 = open, 0 = closed.
  SELECT t.business_hours_id
    INTO v_bh_id
  FROM accounts.setup_teams t
  WHERE t.id = v_queue.team_id
    AND t.organization_id = v_org
  LIMIT 1;

  IF v_bh_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM accounts.setup_business_hours bh
       WHERE bh.id = v_bh_id
         AND bh.organization_id = v_org
         AND coalesce(bh.day_timings, '{}'::jsonb) <> '{}'::jsonb
     )
  THEN
    DECLARE
      v_try bigint;
    BEGIN
      SELECT bh.id
        INTO v_try
      FROM accounts.setup_business_hours bh
      WHERE bh.organization_id = v_org
        AND bh.id = v_queue.team_id
        AND coalesce(bh.day_timings, '{}'::jsonb) <> '{}'::jsonb
      LIMIT 1;
      IF v_try IS NOT NULL THEN
        v_bh_id := v_try;
      END IF;
    END;
  END IF;

  IF v_bh_id IS NOT NULL THEN
    SELECT
      coalesce(nullif(btrim(bh.timezone), ''), 'UTC'),
      bh.holiday_calendar_id,
      bh.day_timings
    INTO v_tz, v_holiday_cal, v_day_timings
    FROM accounts.setup_business_hours bh
    WHERE bh.id = v_bh_id
      AND bh.organization_id = v_org
    LIMIT 1;

    v_tz := coalesce(v_tz, 'UTC');
    v_day_timings := coalesce(v_day_timings, '{}'::jsonb);
    BEGIN
      v_local_ts := timezone(v_tz, now());
    EXCEPTION WHEN others THEN
      v_tz := 'UTC';
      v_local_ts := timezone('UTC', now());
    END;
    v_local_date := v_local_ts::date;
    v_local_time := v_local_ts::time;
    v_day_name := (ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[EXTRACT(DOW FROM v_local_ts)::int + 1];

    IF v_holiday_cal IS NOT NULL THEN
      SELECT true, coalesce(h.audio_path, '')
        INTO v_is_holiday, v_holiday_path
      FROM accounts.setup_holidays h
      WHERE h.calendar_id = v_holiday_cal
        AND h.holiday_date = v_local_date
      LIMIT 1;
      v_is_holiday := coalesce(v_is_holiday, false);
      v_holiday_path := coalesce(v_holiday_path, '');
    END IF;

    IF v_is_holiday THEN
      v_hours := 2;
    ELSE
      SELECT e.value
        INTO v_day_entry
      FROM jsonb_each(v_day_timings) e
      WHERE lower(e.key) = lower(v_day_name)
      LIMIT 1;

      v_open_txt := nullif(btrim(coalesce(
        v_day_entry->>'openTime', v_day_entry->>'open_time', v_day_entry->>'open', ''
      )), '');
      v_close_txt := nullif(btrim(coalesce(
        v_day_entry->>'closeTime', v_day_entry->>'close_time', v_day_entry->>'close', ''
      )), '');

      IF v_open_txt IS NULL OR v_close_txt IS NULL THEN
        v_hours := 0;
      ELSE
        BEGIN
          v_open_time := left(v_open_txt, 5)::time;
          v_close_time := left(v_close_txt, 5)::time;
          -- 00:00–23:59 (or later) is open all day.
          IF v_open_time <= time '00:00' AND v_close_time >= time '23:59' THEN
            v_in_hours := true;
          ELSIF v_open_time <= v_close_time THEN
            v_in_hours := (v_local_time >= v_open_time AND v_local_time <= v_close_time);
          ELSE
            v_in_hours := (v_local_time >= v_open_time OR v_local_time <= v_close_time);
          END IF;
          v_hours := CASE WHEN v_in_hours THEN 1 ELSE 0 END;
        EXCEPTION WHEN others THEN
          v_hours := 0;
        END;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'queueSettings', jsonb_build_object(
      'qid', v_qid,
      'name', coalesce(v_queue.name, ''),
      'domainId', v_org,
      'agentCount', v_agent_count,
      'hoursOfOperation', v_hours,
      'customerType', 1,
      'announcement', jsonb_build_object(
        'type', v_ann_type,
        'textToSpeech', v_ann_tts,
        'voicemail', CASE WHEN coalesce(v_queue.announcement_voicemail, false) THEN 1 ELSE 0 END,
        'callback', CASE WHEN coalesce(v_queue.announcement_callback, false) THEN 1 ELSE 0 END,
        'frequency', coalesce(v_queue.announcement_frequency_seconds, 30),
        'path', v_ann_path
      ),
      'QueueAudioSettings', jsonb_build_object(
        'audio_recording', v_recording,
        'connectingAudioPath', v_connecting,
        'greetingAudioPath', v_greeting,
        'queueAudioPath', v_queue_audio,
        'holdAudioPath', v_hold,
        'holidayPromptPath', v_holiday_path
      ),
      'maximumCallers', jsonb_build_object(
        'queueLimit', v_queue_limit,
        'path', '',
        'voicemail', 0,
        'callback', 0
      ),
      'maximumWaitTime', jsonb_build_object(
        'maxWaitTime', v_max_wait,
        'callback', CASE WHEN coalesce(v_queue.max_wait_callback, false) THEN 1 ELSE 0 END,
        'voicemail', CASE WHEN coalesce(v_queue.max_wait_voicemail, false) THEN 1 ELSE 0 END,
        'path', ''
      ),
      'outOfBusinessHours', jsonb_build_object(
        'path', '',
        'voicemail', CASE WHEN coalesce(v_queue.out_of_businesshour_voicemail, false) THEN 1 ELSE 0 END,
        'callback', CASE WHEN coalesce(v_queue.out_of_businesshour_callback, false) THEN 1 ELSE 0 END
      )
    )
  );
END;
$function$
