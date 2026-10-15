
  create view "worktual_bigint"."ticketing_marts"."mart_users__dbt_tmp"
    
    
  as (
    
select
    user_id,
    organization_id,
    user_name,
    email,
    role,
    status,
    is_active,
    myaccount_user_id,
    last_login_at,
    created_at,
    updated_at
from "worktual_bigint"."ticketing_staging"."stg_users"
  );