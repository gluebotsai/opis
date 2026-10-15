
-- SLA state grain with conversation channel/queue for CCaaS breach reporting.
select
    s.*,
    c.channel,
    c.direction,
    q.queue_name,
    c.priority
from "worktual_bigint"."ccass_staging_aiccaas"."stg_conversation_sla_state" s
left join "worktual_bigint"."ccass_staging_aiccaas"."stg_conversations" c
    on s.conversation_id = c.conversation_id
    and s.organization_id = c.organization_id
left join "worktual_bigint"."ccass_staging_aiccaas"."stg_setup_ccaas_queues" q
    on c.queue_id = q.queue_id
    and c.organization_id = q.organization_id