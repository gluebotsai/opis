
  create view "worktual_bigint"."ticketing_staging"."stg_proactive_approvals__dbt_tmp"
    
    
  as (
    

select
    cast(id as text)                as approval_id,
    cast(organization_id as text)   as organization_id,
    cast(ticket_id as text)         as ticket_id,
    cast(agent_id as text)          as agent_id,
    cast(tool_name as text)         as tool_name,
    cast(tool_name as text)         as summary,
    cast(status as text)            as approval_status,
    cast(status as text)            as status,
    (lower(cast(status as text)) = 'approved')  as is_approved,
    (lower(cast(status as text)) = 'rejected')  as is_rejected,
    (lower(cast(status as text)) = 'pending')   as is_pending,
    (lower(cast(status as text)) in ('approved', 'rejected')) as is_decided,
    0.0                             as decision_hours,
    created_at                      as decided_at,
    created_at
from "worktual_bigint"."ticketing"."proactive_approvals"
  );