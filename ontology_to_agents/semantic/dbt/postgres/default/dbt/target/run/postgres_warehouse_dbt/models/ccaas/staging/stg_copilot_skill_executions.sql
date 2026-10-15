
  create view "worktual_bigint"."ccass_staging_aiccaas"."stg_copilot_skill_executions__dbt_tmp"
    
    
  as (
    -- Tool execution proxy. Confirm actual `status` distinct values in prod
-- (expected: started / succeeded / failed / cancelled) before trusting tool_success_rate.
select
    e.id as execution_id,
    e.organization_id,
    e.session_id,
    e.turn_id,
    t.conversation_id,
    e.skill_key,
    e.tool_key,
    e.status as execution_status,
    e.latency_ms,
    e.error_message,
    e.created_at

from "worktual_bigint"."ccass"."copilot_skill_executions" e
left join "worktual_bigint"."ccass"."copilot_turns" t on e.turn_id = t.id
  );