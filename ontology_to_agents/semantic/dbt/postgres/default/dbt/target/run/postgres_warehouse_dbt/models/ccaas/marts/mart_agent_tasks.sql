
  create view "worktual_bigint"."ccass_marts_aiccaas"."mart_agent_tasks__dbt_tmp"
    
    
  as (
    
-- Agent task grain with assignee display name for SQL agent group_by.
select
    t.*,
    u.user_name as assignee_name
from "worktual_bigint"."ccass_staging_aiccaas"."stg_agent_tasks" t
left join "worktual_bigint"."ccass_staging_aiccaas"."stg_setup_users" u
    on t.assigned_user_id = u.user_id
    and t.organization_id = u.organization_id
  );