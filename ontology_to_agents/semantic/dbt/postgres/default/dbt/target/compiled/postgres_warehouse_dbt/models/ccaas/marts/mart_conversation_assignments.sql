
-- Assignment grain with channel/queue/agent denormalized for MetricFlow group_by.
select
    a.*,
    c.channel,
    c.direction,
    q.queue_name,
    ag.agent_name
from "worktual_bigint"."ccass_staging_aiccaas"."stg_conversation_assignments" a
left join "worktual_bigint"."ccass_staging_aiccaas"."stg_conversations" c
    on a.conversation_id = c.conversation_id
    and a.organization_id = c.organization_id
left join "worktual_bigint"."ccass_staging_aiccaas"."stg_setup_ccaas_queues" q
    on a.queue_id = q.queue_id
    and a.organization_id = q.organization_id
left join "worktual_bigint"."ccass_staging_aiccaas"."stg_agents" ag
    on a.agent_id = ag.agent_id
    and a.organization_id = ag.organization_id