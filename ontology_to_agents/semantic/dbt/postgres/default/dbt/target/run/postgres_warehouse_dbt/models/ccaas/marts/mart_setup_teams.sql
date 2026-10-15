
  create view "worktual_bigint"."ccass_marts_aiccaas"."mart_setup_teams__dbt_tmp"
    
    
  as (
    
select *
from "worktual_bigint"."ccass_staging_aiccaas"."stg_setup_teams"
  );