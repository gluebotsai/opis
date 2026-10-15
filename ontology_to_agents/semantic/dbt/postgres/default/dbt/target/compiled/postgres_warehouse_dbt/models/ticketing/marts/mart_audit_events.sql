

select
    ae.audit_event_id,
    ae.organization_id,
    ae.ticket_id,
    t.ticket_number,
    t.priority              as ticket_priority,
    t.status                as ticket_status,
    t.channel               as ticket_channel,
    t.queue_id,
    t.queue_name,
    t.assignee_id,
    t.assignee_name,
    ae.action,
    ae.actor_id,
    ae.actor_name,
    ae.is_escalation_event,
    ae.is_assignment_event,
    ae.created_at
from "worktual_bigint"."ticketing_staging"."stg_audit_events" ae
left join "worktual_bigint"."ticketing_staging"."stg_tickets" t
    on ae.ticket_id = t.ticket_id
    and ae.organization_id = t.organization_id