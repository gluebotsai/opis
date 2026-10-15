

select
    cast(id as text)                as audit_event_id,
    cast(organization_id as text)   as organization_id,
    cast(ticket_id as text)         as ticket_id,
    cast(action as text)            as action,
    cast(actor_id as text)          as actor_id,
    cast(actor_name as text)        as actor_name,
    (lower(cast(action as text)) in ('escalate', 'escalated', 'ticket.escalated')) as is_escalation_event,
    (lower(cast(action as text)) in ('reassign', 'reassigned', 'assign', 'assigned', 'ticket.assigned', 'ticket.reassigned')) as is_assignment_event,
    created_at
from "worktual_bigint"."ticketing"."audit_events"