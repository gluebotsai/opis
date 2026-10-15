
  create view "worktual_bigint"."ccass_staging_aiccaas"."stg_agents__dbt_tmp"
    
    
  as (
    -- models/staging/stg_agents.sql
select
    id as agent_id,
    organization_id,
    display_name as agent_name,
    email,
    status,
    created_at
from "worktual_bigint"."ccass"."agents"
  );