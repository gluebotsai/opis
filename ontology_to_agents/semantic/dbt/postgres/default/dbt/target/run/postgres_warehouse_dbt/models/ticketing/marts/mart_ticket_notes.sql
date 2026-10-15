
  create view "worktual_bigint"."ticketing_marts"."mart_ticket_notes__dbt_tmp"
    
    
  as (
    
-- Ticket notes/replies denormalized with parent ticket's priority, status,
-- queue, and assignee, so reply-volume / agent-activity metrics can be
-- grouped or filtered by ticket context without a query-time join.
select
    n.ticket_note_id,
    n.organization_id,
    n.ticket_id,
    t.ticket_number,
    t.priority              as ticket_priority,
    t.status                as ticket_status,
    t.queue_id,
    t.queue_name,
    t.assignee_id,
    t.assignee_name,
    n.author_id,
    n.author_name,
    n.visibility,
    n.is_internal_note,
    n.created_at
from "worktual_bigint"."ticketing_staging"."stg_ticket_notes" n
left join "worktual_bigint"."ticketing_staging"."stg_tickets" t
    on n.ticket_id = t.ticket_id
    and n.organization_id = t.organization_id
  );