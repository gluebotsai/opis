
  create view "worktual_bigint"."ticketing_staging"."stg_macros__dbt_tmp"
    
    
  as (
    

select
    cast(id as text)                as macro_id,
    cast(organization_id as text)   as organization_id,
    cast(title as text)             as macro_title,
    cast(title as text)             as title,
    cast(body as text)              as body,
    cast(created_by_id as text)     as created_by_id,
    cast(created_by_id as text)     as created_by_user_id,
    cast(created_by_name as text)   as created_by_name,
    created_at,
    updated_at
from "worktual_bigint"."ticketing"."macros"
  );