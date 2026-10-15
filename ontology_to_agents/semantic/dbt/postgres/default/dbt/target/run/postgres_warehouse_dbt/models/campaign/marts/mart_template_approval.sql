
  
    

  create  table "worktual_bigint"."campaign_marts"."mart_template_approval__dbt_tmp"
  
  
    as
  
  (
    -- Grain: organization_id + channel_name. Supports template_count, template_approval_rate.
-- Only covers regulated_channel_templates (sms/whatsapp). Non-regulated channel templates
-- (campaign_channel_templates, used pre-save in agent sessions) have no approval concept
-- and are excluded here.
with templates as (
    select * from "worktual_bigint"."campaign_staging"."stg_regulated_channel_templates"
)

select
    organization_id,
    channel_name,
    min(submitted_at)                          as first_submitted_at,
    max(last_status_checked_at)                as last_checked_at,
    count(*)                                   as template_count,
    count(*) filter (where is_approved_flag)    as approved_template_count,
    count(*) filter (where is_rejected_flag)    as rejected_template_count,
    count(*) filter (where is_approved_flag)::numeric
        / nullif(count(*), 0)                  as template_approval_rate
from templates
group by 1, 2
  );
  