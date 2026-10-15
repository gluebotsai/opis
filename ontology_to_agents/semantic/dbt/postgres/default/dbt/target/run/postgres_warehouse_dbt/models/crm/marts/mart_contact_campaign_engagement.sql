
  create view "worktual_bigint"."crm_marts"."mart_contact_campaign_engagement__dbt_tmp"
    
    
  as (
    

select
    c.contact_id,
    c.organization_id,
    c.lifecycle_stage,
    c.lead_source,
    c.crm_status,
    ce.email_unsubscribed,
    ce.last_email_opened_at,
    ce.last_email_clicked_at,
    ce.lifetime_open_count,
    ce.lifetime_click_count
from "worktual_bigint"."crm_staging"."stg_contact_profiles" c
left join "worktual_bigint"."campaign_staging"."stg_campaign_contact_engagement" ce
    on c.contact_id = cast(ce.contact_id as text)
    and c.organization_id = cast(ce.organization_id as text)
  );