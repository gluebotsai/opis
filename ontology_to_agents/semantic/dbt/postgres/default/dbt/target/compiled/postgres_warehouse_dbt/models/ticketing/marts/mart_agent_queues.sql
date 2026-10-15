
select
    queue_id,
    organization_id,
    external_id,
    queue_name,
    queue_type,
    sla_status,
    (lower(sla_status) = 'at_risk') as is_at_risk,
    open_tickets,
    assigned,
    created_at,
    updated_at
from "worktual_bigint"."ticketing_staging"."stg_agent_queues"