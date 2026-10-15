
  create view "worktual_bigint"."ccass_staging_aiccaas"."stg_setup_ccaas_queue_agents__dbt_tmp"
    
    
  as (
    select
    qa.id as queue_agent_id,
    qa.queue_id,
    qa.user_id,
    q.organization_id,
    qa.handles_calls,
    qa.handles_email,
    qa.handles_chat,
    qa.handles_whatsapp,
    qa.handles_social,
    qa.call_type,
    qa.shift_type,
    qa.created_at
from "worktual_bigint"."accounts"."setup_ccaas_queue_agents" qa
left join "worktual_bigint"."accounts"."setup_ccaas_queues" q on qa.queue_id = q.id
  );