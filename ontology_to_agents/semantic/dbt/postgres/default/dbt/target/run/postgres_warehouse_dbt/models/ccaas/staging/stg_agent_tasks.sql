
  create view "worktual_bigint"."ccass_staging_aiccaas"."stg_agent_tasks__dbt_tmp"
    
    
  as (
    select
    id as task_id,
    organization_id,
    assigned_user_id,
    task_type,
    status,
    priority,
    channel,
    due_at,
    completed_at,
    dismissed_at,
    created_at
from "worktual_bigint"."ccass"."agent_tasks"
  );