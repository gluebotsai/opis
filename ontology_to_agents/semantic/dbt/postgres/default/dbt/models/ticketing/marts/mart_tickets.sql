{{ config(materialized='view') }}
-- Tickets denormalized with queue type, B2B account name, assignee role,
-- status-driven terminal flag, org attributes, and SLA target hours by
-- priority — so metrics can be grouped/filtered on all of these directly
-- without a query-time join.
select
    t.ticket_id,
    t.organization_id,
    o.organization_name,
    o.business_type             as organization_business_type,
    t.ticket_number,
    t.subject,
    t.status,
    ts.status_display_name,
    ts.is_terminal               as is_closed_by_status,
    t.priority,
    t.channel,
    t.customer_id,
    t.customer_name,
    t.customer_email,
    c.account_id,
    a.account_name,
    t.assignee_id,
    t.assignee_name,
    u.role                      as assignee_role,
    t.resolver_id,
    t.resolver_name,
    t.queue_id,
    t.queue_name,
    q.queue_type,
    q.sla_status                as queue_sla_status,
    true                        as team_supports_ticketing,
    t.category,
    t.skill,
    t.due_at,
    t.first_response_at,
    t.resolved_at,
    t.csat_score,
    t.csat_rated_at,
    t.created_by_id,
    t.created_by_name,
    -- outcome-timestamp-driven flags
    t.is_resolved,
    case when lower(t.status) = 'open' then true else false end as is_open,
    t.is_breached_proxy,
    t.resolution_hours,
    t.first_response_hours,
    case when t.first_response_at is not null
         then extract(epoch from (t.first_response_at - t.created_at)) / 60.0
    end                          as first_response_minutes,
    t.has_first_response,
    t.has_csat_score,
    -- Dimension helper flags
    case when t.assignee_id is not null and t.assignee_name is not null and t.assignee_name != 'Unassigned'
         then true else false end as has_assignee,
    case when t.resolver_id is not null or (t.resolver_name is not null and t.resolver_name != '')
         then true else false end as has_resolver,
    case when t.csat_score is not null then true else false end as has_csat_rating,
    case when (not coalesce(ts.is_terminal, false) and lower(t.status) != 'resolved')
              and t.due_at is not null
              and t.due_at < now()
         then true else false end as is_overdue,
    case when lower(t.status) = 'reopened' then true else false end as is_reopened,
    case when not (coalesce(ts.is_terminal, false) or lower(t.status) = 'resolved') then true else false end as is_pending,
    case when coalesce(ts.is_terminal, false) or lower(t.status) = 'resolved' then true else false end as is_closed,
    case when t.is_open and lower(t.priority) = 'high'
         then true else false end as is_high_priority_open,
    case when (not coalesce(ts.is_terminal, false) and lower(t.status) != 'resolved') and t.due_at is not null and date(t.due_at) = current_date
         then true else false end as is_due_today,
    case when (not coalesce(ts.is_terminal, false) and lower(t.status) != 'resolved')
              and t.due_at is not null
              and date(t.due_at) = current_date
         then true else false end as is_sla_at_risk,
    case when t.resolved_at is not null and t.due_at is not null and t.resolved_at > t.due_at
         then extract(epoch from (t.resolved_at - t.due_at)) / 3600.0
    end                          as overdue_hours,
    case when t.resolved_at is not null and t.due_at is not null and t.resolved_at <= t.due_at then true
         when t.is_resolved and sp.resolution_hours is not null and t.resolution_hours <= sp.resolution_hours then true
         else false end          as is_resolution_sla_met,
    case when t.resolved_at is not null and (t.due_at is not null or sp.resolution_hours is not null)
         then true else false end as has_resolution_sla_target,
    -- SLA target hours by priority, for actual-vs-target comparison
    sp.resolution_hours          as sla_resolution_hours,
    sp.first_response_hours      as sla_first_response_hours,
    case when t.is_resolved and sp.resolution_hours is not null
         then t.resolution_hours - sp.resolution_hours
    end                          as resolution_hours_variance,
    t.created_at,
    t.updated_at
from {{ ref('stg_tickets') }} t
left join {{ ref('stg_customers') }} c
    on t.customer_id = c.customer_id
    and t.organization_id = c.organization_id
left join {{ ref('stg_accounts') }} a
    on c.account_id = a.account_id
    and t.organization_id = a.organization_id
left join {{ ref('stg_agent_queues') }} q
    on t.queue_id = q.queue_id
    and t.organization_id = q.organization_id
left join {{ ref('stg_users') }} u
    on t.assignee_id = u.user_id
    and t.organization_id = u.organization_id
left join {{ ref('stg_ticketing_organizations') }} o
    on t.organization_id = o.organization_id
left join {{ ref('stg_ticket_statuses') }} ts
    on t.status = ts.status
    and t.organization_id = ts.organization_id
left join {{ ref('stg_sla_policies') }} sp
    on t.priority = sp.priority
    and t.organization_id = sp.organization_id