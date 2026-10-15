
  create view "worktual_bigint"."ccass_marts_aiccaas"."mart_agent_capacity__dbt_tmp"
    
    
  as (
    
select *
from "worktual_bigint"."ccass_staging_aiccaas"."stg_agent_capacity"
  );