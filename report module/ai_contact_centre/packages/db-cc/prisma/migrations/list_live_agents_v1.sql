-- Live agents for the voice bot, in the UMN list shape.
-- Call: SELECT ccass.list_live_agents(<organization_id>);
-- organization_id is the UMN domainId.
-- Their code keeps statusName = 'Ready' and derives ID, Name, Email, ext, Skills, qid.

CREATE OR REPLACE FUNCTION ccass.list_live_agents(p_organization_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ccass, accounts, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(agent_row ORDER BY agent_row->>'ext', agent_row->>'UserID'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'statusName',
      CASE ap.presence_state
        WHEN 'ready' THEN 'Ready'
        WHEN 'not_ready' THEN 'Not Ready'
        WHEN 'busy' THEN 'Busy'
        WHEN 'away' THEN 'Away'
        WHEN 'break' THEN 'Break'
        WHEN 'after_contact_work' THEN 'After Contact Work'
        WHEN 'offline' THEN 'Offline'
        ELSE initcap(replace(ap.presence_state, '_', ' '))
      END,
      'UserID', su.id,
      'UserName', btrim(concat_ws(' ', su.first_name, su.last_name)),
      'emailId', su.work_email,
      'directNumber',
      CASE
        WHEN regexp_replace(coalesce(su.mobile_number, ''), '[^0-9]', '', 'g') ~ '^[0-9]{1,18}$'
        THEN regexp_replace(su.mobile_number, '[^0-9]', '', 'g')::bigint
        ELSE NULL
      END,
      'address', NULL,
      'routing_profile_id', 0,
      'report_to_UserID', 0,
      'sipLoginId',
      CASE
        WHEN btrim(coalesce(su.sip_login_id, '')) ~ '^[0-9]{1,18}$'
        THEN btrim(su.sip_login_id)::bigint
        ELSE 0
      END,
      'companyId', su.organization_id,
      'domainId', su.organization_id,
      'ext', su.ext,
      'isActive',
      CASE
        WHEN lower(su.status) = 'active' AND lower(a.status) = 'active' THEN 1
        ELSE 0
      END,
      'callTypeId', 1,
      'roleid', coalesce(access.role_id, 0),
      'localization', '0',
      'currentSession', NULL,
      'isVoice', CASE WHEN queue.handles_calls IS TRUE THEN 1 ELSE 0 END,
      'isVoiceCallTransfer', 0,
      'isChat', CASE WHEN queue.handles_chat IS TRUE THEN 1 ELSE 0 END,
      'isChatTransfer', 0,
      'isEmail', CASE WHEN queue.handles_email IS TRUE THEN 1 ELSE 0 END,
      'isEmailTransfer', 0,
      'StatusID', 0,
      'isSms', 0,
      'isSocialMedia', CASE WHEN queue.handles_social IS TRUE THEN 1 ELSE 0 END,
      'companyName', coalesce(org.company_name, ''),
      'addSkill', coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object('skid', 0, 'type', 'Custom', 'value', skill_name)
            ORDER BY skill_ord
          )::text
          FROM jsonb_array_elements_text(skills.names) WITH ORDINALITY AS skill(skill_name, skill_ord)
        ),
        '[]'
      ),
      'voice', 0,
      'chat', 0,
      'email', 0,
      'sms', 0,
      'socialMedia', 0,
      'stateTimer', floor(extract(epoch FROM ap.updated_at))::bigint::text,
      'isVoiceCallTransfer_AgentStatus', 0,
      'isChatTransfer_AgentStatus', 0,
      'isEmailTransfer_AgentStatus', 0,
      'quId', coalesce(queue.queue_id::text, '')
    ) AS agent_row
    FROM accounts.setup_users su
    JOIN ccass.agents a
      ON a.setup_user_id = su.id
     AND a.organization_id = su.organization_id
    JOIN ccass.agent_presence ap
      ON ap.agent_id = a.id
     AND ap.organization_id = a.organization_id
    JOIN accounts.organizations org
      ON org.id = su.organization_id
    LEFT JOIN LATERAL (
      SELECT supa.role_id
      FROM accounts.setup_user_product_access supa
      WHERE supa.user_id = su.id
        AND supa.organization_id = su.organization_id
        AND supa.product_id = 'contact-center'
      LIMIT 1
    ) access ON TRUE
    LEFT JOIN LATERAL (
      SELECT q.id AS queue_id,
             qa.handles_calls,
             qa.handles_chat,
             qa.handles_email,
             qa.handles_social
      FROM accounts.setup_ccaas_queue_agents qa
      JOIN accounts.setup_ccaas_queues q
        ON q.id = qa.queue_id
       AND q.organization_id = su.organization_id
      WHERE qa.user_id = su.id
      ORDER BY qa.id ASC
      LIMIT 1
    ) queue ON TRUE
    LEFT JOIN LATERAL (
      SELECT coalesce(
        (
          SELECT jsonb_agg(skill_name ORDER BY skill_ord)
          FROM (
            SELECT skill_ord,
                   btrim(
                     CASE
                       WHEN jsonb_typeof(elem) = 'string' THEN elem #>> '{}'
                       WHEN jsonb_typeof(elem) = 'object' THEN coalesce(elem->>'value', elem->>'name')
                       ELSE NULL
                     END
                   ) AS skill_name
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(su.skills::jsonb) = 'array' THEN su.skills::jsonb
                ELSE '[]'::jsonb
              END
            ) WITH ORDINALITY AS raw_skill(elem, skill_ord)
          ) parsed
          WHERE skill_name IS NOT NULL AND skill_name <> ''
        ),
        (
          SELECT jsonb_agg(sk.name ORDER BY ags.priority, ags.id)
          FROM ccass.agent_skills ags
          JOIN ccass.skills sk
            ON sk.id = ags.skill_id
           AND sk.organization_id = ags.organization_id
          WHERE ags.agent_id = a.id
            AND ags.organization_id = a.organization_id
            AND sk.is_active
        ),
        '[]'::jsonb
      ) AS names
    ) skills ON TRUE
    WHERE su.organization_id = p_organization_id
      AND su.ext IS NOT NULL
  ) listed
$$;
