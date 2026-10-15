-- Presence interval source for the presence-based occupancy metric.
select
    id as presence_event_id,
    organization_id,
    agent_id,
    previous_state,
    new_state,
    reason_code,
    started_at,
    ended_at,

    extract(epoch from (coalesce(ended_at, now()) - started_at)) as interval_seconds,

    case when new_state in ('busy', 'after_contact_work') then true else false end as is_handling_or_wrap,
    case when new_state != 'offline' then true else false end as is_logged_in_eligible

from "worktual_bigint"."ccass"."agent_presence_history"