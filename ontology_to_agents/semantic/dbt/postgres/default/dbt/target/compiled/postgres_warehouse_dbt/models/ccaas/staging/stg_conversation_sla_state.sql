select
    s.id as sla_state_id,
    s.organization_id,
    s.conversation_id,
    s.sla_policy_id,
    s.first_response_due_at,
    s.resolution_due_at,
    s.breached_at,
    s.updated_at,
    c.queue_id
from "worktual_bigint"."ccass"."conversation_sla_state" s
left join "worktual_bigint"."ccass_staging_aiccaas"."stg_conversations" c
    on s.conversation_id = c.conversation_id
    and s.organization_id = c.organization_id