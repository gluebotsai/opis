
  create view "worktual_bigint"."crm_staging"."stg_proposals__dbt_tmp"
    
    
  as (
    

select
    cast(id as text)                    as proposal_id,
    cast(organization_id as text)       as organization_id,
    cast(deal_id as text)               as deal_id,
    cast(created_by_user_id as text)    as created_by_user_id,
    cast(number as text)                as proposal_number,
    cast(title as text)                 as title,
    cast(version as text)               as version,
    cast(status as text)                as proposal_status,
    shared_at,
    (cast(status as text) = 'accepted') as is_accepted,
    (cast(status as text) in ('shared','accepted','declined')) as is_sent,
    created_at,
    updated_at
from "worktual_bigint"."crm"."proposals"
  );