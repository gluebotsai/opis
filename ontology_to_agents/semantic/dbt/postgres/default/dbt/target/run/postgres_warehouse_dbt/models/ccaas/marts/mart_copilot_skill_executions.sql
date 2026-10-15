
  create view "worktual_bigint"."ccass_marts_aiccaas"."mart_copilot_skill_executions__dbt_tmp"
    
    
  as (
    
-- Tool execution grain with conversation_id for join-back to interactions.
select
    execution_id,
    organization_id,
    session_id,
    turn_id,
    conversation_id,
    skill_key,
    tool_key,
    execution_status,
    latency_ms,
    error_message,
    created_at
from "worktual_bigint"."ccass_staging_aiccaas"."stg_copilot_skill_executions"
  );