
  create view "worktual_bigint"."ticketing_staging"."stg_setup_users__dbt_tmp"
    
    
  as (
    

select
    user_id                                         as myaccount_user_id,
    organization_id,
    first_name,
    last_name,
    cast(first_name || ' ' || last_name as text)    as myaccount_full_name,
    work_email                                      as myaccount_work_email,
    status                                          as myaccount_user_status,
    created_at,
    updated_at
from "worktual_bigint"."shared_staging"."stg_accounts_setup_users"
  );