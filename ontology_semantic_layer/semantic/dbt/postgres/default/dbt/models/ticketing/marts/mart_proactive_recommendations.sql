{{ config(materialized='view') }}

select
    r.recommendation_id,
    r.organization_id,
    r.agent_id,
    r.ticket_id,
    t.ticket_number,
    r.summary,
    r.status,
    r.is_accepted,
    r.is_dismissed,
    r.is_open,
    t.priority          as ticket_priority,
    t.status            as ticket_status,
    t.queue_id,
    t.queue_name,
    r.created_at
from {{ ref('stg_proactive_recommendations') }} r
left join {{ ref('stg_tickets') }} t
    on r.ticket_id = t.ticket_id
    and r.organization_id = t.organization_id
