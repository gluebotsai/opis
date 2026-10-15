
  create view "worktual_bigint"."ccass_marts_aiccaas"."mart_agent_presence_history__dbt_tmp"
    
    
  as (
    
-- Presence interval grain with agent display name for occupancy reporting.
select
    p.*,
    a.agent_name
from "worktual_bigint"."ccass_staging_aiccaas"."stg_agent_presence_history" p
left join "worktual_bigint"."ccass_staging_aiccaas"."stg_agents" a
    on p.agent_id = a.agent_id
    and p.organization_id = a.organization_id
  );