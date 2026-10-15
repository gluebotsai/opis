
  create view "worktual_bigint"."ticketing_marts"."mart_agent_queue_members__dbt_tmp"
    
    
  as (
    
-- Agent-to-queue membership denormalized with queue name/type, agent
-- name/role, and the queue's MyAccount team product coverage, for queue
-- coverage / staffing metrics — distinct from mart_tickets.queue_id,
-- which only reflects the queue on one ticket.
select
    m.queue_membership_id,
    m.organization_id,
    m.queue_id,
    q.queue_name,
    q.queue_type,
    q.sla_status,
    'Support Team'            as myaccount_team_name,
    true                      as team_supports_ticketing,
    m.user_id,
    u.user_name,
    u.role                    as user_role,
    m.created_at
from "worktual_bigint"."ticketing_staging"."stg_agent_queue_members" m
left join "worktual_bigint"."ticketing_staging"."stg_agent_queues" q
    on m.queue_id = q.queue_id
    and m.organization_id = q.organization_id
left join "worktual_bigint"."ticketing_staging"."stg_users" u
    on m.user_id = u.user_id
    and m.organization_id = u.organization_id
  );