

select
    a.approval_id,
    a.organization_id,
    a.agent_id,
    a.ticket_id,
    t.ticket_number,
    a.summary,
    a.tool_name,
    a.status,
    a.is_approved,
    a.is_rejected,
    a.is_pending,
    a.decision_hours,
    t.priority          as ticket_priority,
    t.status            as ticket_status,
    t.queue_id,
    t.queue_name,
    a.created_at,
    a.decided_at
from "worktual_bigint"."ticketing_staging"."stg_proactive_approvals" a
left join "worktual_bigint"."ticketing_staging"."stg_tickets" t
    on a.ticket_id = t.ticket_id
    and a.organization_id = t.organization_id