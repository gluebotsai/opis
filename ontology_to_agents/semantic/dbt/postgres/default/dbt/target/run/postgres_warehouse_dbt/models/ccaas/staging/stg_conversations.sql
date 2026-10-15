
  create view "worktual_bigint"."ccass_staging_aiccaas"."stg_conversations__dbt_tmp"
    
    
  as (
    select
    id as conversation_id,
    organization_id,
    -- Normalize channel enums so MetricFlow group_by/filters stay consistent.
    case
        when lower(coalesce(channel, '')) in ('web_chat', 'webchat') then 'webchat'
        when lower(coalesce(channel, '')) in ('voice', 'call') then 'voice'
        else lower(channel)
    end as channel,
    direction,
    contact_id,
    profile_id,
    queue_id,
    assigned_agent_id,
    status,
    priority,
    lifecycle_state,
    sla_status,
    handoff_reason,
    disposition_code,
    resolution_code,
    created_at,
    queued_at,
    assigned_at,
    first_response_at,
    resolved_at,
    closed_at,
    ended_at,

    -- proxy flag: conversation stayed AI-only, no human ever assigned/handed to,
    -- and reached a terminal state. lifecycle_state is always 'ended' in prod
    -- (never 'bot'/'agent'/'human') so it cannot be used as a signal here.
    case
        when handoff_reason is null
         and assigned_agent_id is null
         and (status in ('resolved', 'closed') or closed_at is not null)
        then true
        else false
    end as is_ai_only_completed,

    -- proxy flag: a handoff to a human was ever requested (does not imply completion)
    (handoff_reason is not null) as had_handoff,

    -- handled = reached a terminal outcome by ANY means, bot or human.
    -- Do NOT use handoff_reason here — it only means a handoff was requested,
    -- not that the conversation was actually handled by anyone.
    case
        when assigned_agent_id is not null
          or status in ('resolved', 'closed')
          or closed_at is not null
        then true
        else false
    end as is_handled,

    case
        when status = 'resolved' or resolution_code is not null or resolved_at is not null
        then true
        else false
    end as is_resolved,

    case when first_response_at is not null and created_at is not null
        then extract(epoch from (first_response_at - created_at))
    end as first_response_seconds,

    case when assigned_at is not null and queued_at is not null
        then extract(epoch from (assigned_at - queued_at))
    end as speed_of_answer_seconds,

    -- Queue-depth snapshot: terminal statuses are resolved/closed (not a literal 'open').
    (status not in ('resolved', 'closed')) as is_open

from "worktual_bigint"."ccass"."conversations"
  );