
  create view "worktual_bigint"."ccass_staging_aiccaas"."stg_agent_capacity__dbt_tmp"
    
    
  as (
    select
    id as capacity_id,
    organization_id,
    agent_id,
    channel,
    max_concurrency,
    reserved_count,
    active_count,
    updated_at
from "worktual_bigint"."ccass"."agent_capacity"
  );