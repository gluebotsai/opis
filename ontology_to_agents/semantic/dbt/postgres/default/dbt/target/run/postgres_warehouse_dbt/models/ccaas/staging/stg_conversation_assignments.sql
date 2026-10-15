
  create view "worktual_bigint"."ccass_staging_aiccaas"."stg_conversation_assignments__dbt_tmp"
    
    
  as (
    select
    id as assignment_id,
    organization_id,
    conversation_id,
    queue_id,
    agent_id,
    state,
    reason,
    offered_at,
    accepted_at,
    rejected_at,
    expired_at,
    ended_at,

    -- per-human-leg handle time (canonical AHT source, agreed definition)
    case when accepted_at is not null and ended_at is not null
        then extract(epoch from (ended_at - accepted_at))
    end as human_handle_seconds,

    (accepted_at is not null and ended_at is not null) as is_completed_leg

from "worktual_bigint"."ccass"."conversation_assignments"
  );