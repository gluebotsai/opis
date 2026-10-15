
  
    

  create  table "worktual_bigint"."campaign_marts"."mart_campaign_overview__dbt_tmp"
  
  
    as
  
  (
    -- Grain: campaign_id. Supports: campaign_count, campaign_volume,
-- live_campaign_count, scheduled_campaign_count, audience_reached.
with campaigns as (
    select * from "worktual_bigint"."campaign_staging"."stg_campaigns"
),

audience as (
    select
        campaign_id,
        count(distinct contact_id) as audience_reached
    from "worktual_bigint"."campaign_staging"."stg_campaign_audience"
    group by 1
)

select
    c.campaign_id,
    c.organization_id,
    c.branch_id,
    c.campaign_name,
    c.campaign_status,
    c.source_channel,
    c.is_live_flag,
    c.is_scheduled_flag,
    c.is_completed_flag,
    c.audience_count as snapshot_audience_count,   -- denormalized at save time
    coalesce(a.audience_reached, 0) as audience_reached,  -- recomputed from campaign_audience
    c.planned_duration_seconds,
    c.starts_at,
    c.ends_at,
    c.created_at
from campaigns c
left join audience a using (campaign_id)
  );
  