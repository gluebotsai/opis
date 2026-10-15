-- ccass.updateagentstatus
-- Database: worktual_bigint
--
-- Why
-- CCaaS attendance reads ccass.agent_presence_history.
-- Updating only ccass.agent_presence does not create attendance.
--
-- Where
-- Replace ccass.updateagentstatus. Call this function for every presence change.
-- Do not update ccass.agent_presence from a separate query.
--
-- What
-- Old calls with organization, extension, and state are unchanged:
--   ready / busy / not_ready / away keep the same reason map and source telephony.
-- Pass ccaasReasonCode and ccaasSource when you have the Redis payload.
-- A history row is inserted only when the state changes.
--
-- Call
-- SELECT ccass.updateagentstatus(
--   <ccaasOrganizationId>, <ext>, <ccaasState>, <ccaasReasonCode>, <ccaasSource>
-- );

DROP FUNCTION IF EXISTS ccass.updateagentstatus(bigint, text, text);

CREATE OR REPLACE FUNCTION ccass.updateagentstatus(p_organization_id bigint, p_ext text, p_presence_state text, p_reason_code text DEFAULT NULL::text, p_source text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ccass', 'accounts', 'pg_temp'
AS $function$
DECLARE
  v_state         text := lower(btrim(coalesce(p_presence_state, '')));
  v_reason        text;
  v_source        text;
  v_agent_id      bigint;
  v_prev_state    text;
  v_existed       boolean;
  v_state_changed boolean;
BEGIN
  IF v_state IN ('not ready', 'not_ready') THEN
    v_state := 'not_ready';
  END IF;

  IF v_state NOT IN ('ready', 'busy', 'not_ready', 'away', 'break', 'after_contact_work', 'offline') THEN
    RETURN 'failed to update';
  END IF;

  IF NULLIF(btrim(coalesce(p_reason_code, '')), '') IS NOT NULL THEN
    v_reason := btrim(p_reason_code);
  ELSIF v_state = 'ready' THEN
    v_reason := NULL;
  ELSIF v_state = 'busy' THEN
    v_reason := 'on_call';
  ELSIF v_state = 'not_ready' THEN
    v_reason := 'not_reached';
  ELSIF v_state = 'away' THEN
    v_reason := 'offer_timeout';
  ELSIF v_state IN ('break', 'after_contact_work', 'offline') THEN
    v_reason := NULL;
  ELSE
    RETURN 'failed to update';
  END IF;

  v_source := COALESCE(NULLIF(btrim(coalesce(p_source, '')), ''), 'telephony');

  SELECT a.id
    INTO v_agent_id
  FROM accounts.setup_users su
  JOIN ccass.agents a
    ON a.setup_user_id = su.id
   AND a.organization_id = su.organization_id
  WHERE su.organization_id = p_organization_id
    AND su.ext::text = btrim(p_ext)
  LIMIT 1;

  IF v_agent_id IS NULL THEN
    RETURN 'failed to update';
  END IF;

  SELECT TRUE, ap.presence_state
    INTO v_existed, v_prev_state
  FROM ccass.agent_presence ap
  WHERE ap.agent_id = v_agent_id;

  v_existed := coalesce(v_existed, FALSE);
  v_state_changed := (NOT v_existed) OR (v_prev_state IS DISTINCT FROM v_state);

  INSERT INTO ccass.agent_presence (
    organization_id,
    agent_id,
    status,
    presence_state,
    reason_code,
    source,
    heartbeat_at,
    lease_expires_at,
    updated_at,
    version
  )
  VALUES (
    p_organization_id,
    v_agent_id,
    v_state,
    v_state,
    v_reason,
    v_source,
    now(),
    NULL,
    now(),
    1
  )
  ON CONFLICT (agent_id) DO UPDATE SET
    organization_id  = EXCLUDED.organization_id,
    status           = EXCLUDED.status,
    presence_state   = EXCLUDED.presence_state,
    reason_code      = EXCLUDED.reason_code,
    source           = EXCLUDED.source,
    heartbeat_at     = EXCLUDED.heartbeat_at,
    lease_expires_at = NULL,
    version          = ccass.agent_presence.version + 1,
    updated_at       = CASE
                         WHEN ccass.agent_presence.presence_state IS DISTINCT FROM EXCLUDED.presence_state
                         THEN now()
                         ELSE ccass.agent_presence.updated_at
                       END;

  IF v_state_changed THEN
    INSERT INTO ccass.agent_presence_history (
      organization_id,
      agent_id,
      previous_state,
      new_state,
      reason_code,
      source,
      started_at,
      ended_at
    )
    VALUES (
      p_organization_id,
      v_agent_id,
      v_prev_state,
      v_state,
      v_reason,
      v_source,
      now(),
      now()
    );
  END IF;

  IF v_existed THEN
    RETURN 'updated';
  ELSE
    RETURN 'inserted';
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RETURN 'failed to update';
END;
$function$
