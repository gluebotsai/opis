
  create view "worktual_bigint"."ccass_marts_aiccaas"."mart_setup_users__dbt_tmp"
    
    
  as (
    
select *
from "worktual_bigint"."ccass_staging_aiccaas"."stg_setup_users"
  );