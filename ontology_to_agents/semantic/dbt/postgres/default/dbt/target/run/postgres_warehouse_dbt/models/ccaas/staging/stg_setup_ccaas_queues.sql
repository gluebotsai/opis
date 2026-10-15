
  create view "worktual_bigint"."ccass_staging_aiccaas"."stg_setup_ccaas_queues__dbt_tmp"
    
    
  as (
    -- Real queue definitions (replaces earlier placeholder queue source)
select
    id as queue_id,
    organization_id,
    name as queue_name,
    team_id,
    business_hours_id,
    status,
    created_at,
    updated_at
from "worktual_bigint"."accounts"."setup_ccaas_queues"
  );