
  create view "worktual_bigint"."crm_marts"."mart_proposals__dbt_tmp"
    
    
  as (
    

select
    p.proposal_id,
    p.organization_id,
    d.business_type,
    p.deal_id,
    p.proposal_number,
    p.title,
    p.version,
    p.proposal_status,
    p.is_accepted,
    p.is_sent,
    p.shared_at,
    p.created_by_user_id,
    u.full_name          as created_by_name,
    d.owner_user_id       as deal_owner_user_id,
    d.owner_name,
    p.created_at,
    p.updated_at
from "worktual_bigint"."crm_staging"."stg_proposals" p
left join "worktual_bigint"."crm_marts"."mart_deals" d
    on p.deal_id = d.deal_id
    and p.organization_id = d.organization_id
left join "worktual_bigint"."crm_staging"."stg_setup_users" u
    on p.created_by_user_id = u.user_id
    and p.organization_id = u.organization_id
  );