
  create view "worktual_bigint"."crm_marts"."mart_deal_activities__dbt_tmp"
    
    
  as (
    

select
    da.deal_activity_id,
    da.deal_id,
    da.organization_id,
    d.business_type,
    da.activity_type,
    da.subject,
    da.due_at,
    da.completed_at,
    da.is_completed,
    da.created_by_user_id,
    u.full_name          as created_by_name,
    d.stage              as deal_stage,
    d.owner_user_id       as deal_owner_user_id,
    d.owner_name,
    da.created_at,
    da.updated_at
from "worktual_bigint"."crm_staging"."stg_deal_activities" da
left join "worktual_bigint"."crm_marts"."mart_deals" d
    on da.deal_id = d.deal_id
    and da.organization_id = d.organization_id
left join "worktual_bigint"."crm_staging"."stg_setup_users" u
    on da.created_by_user_id = u.user_id
    and da.organization_id = u.organization_id
  );