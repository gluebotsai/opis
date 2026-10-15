
  create view "worktual_bigint"."campaign_staging"."stg_campaigns__dbt_tmp"
    
    
  as (
    -- One row per saved campaign. Grain: campaign_id.
select
    id                      as campaign_id,
    organization_id,
    branch_id,
    created_by_user_id,
    session_id              as agent_session_id,
    name                    as campaign_name,
    status                  as campaign_status,       -- draft/scheduled/live/completed/cancelled
    source_channel,                                    -- standalone_campaign / crm_marketing
    goal                    as campaign_goal,
    objective               as campaign_objective,
    audience_count,
    starts_at,
    ends_at,
    launch_local_date,
    launch_local_time,
    timezone,
    created_at,
    updated_at,
    -- derived: own-table only
    extract(epoch from (ends_at - starts_at)) as planned_duration_seconds,
    (status = 'live')       as is_live_flag,
    (status = 'scheduled')  as is_scheduled_flag,
    (status = 'completed')  as is_completed_flag
from "worktual_bigint"."campaign"."campaigns"
  );