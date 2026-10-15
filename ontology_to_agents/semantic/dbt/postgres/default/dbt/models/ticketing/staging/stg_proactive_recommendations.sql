{{ config(materialized='view') }}

select
    cast(id as text)                as recommendation_id,
    cast(organization_id as text)   as organization_id,
    cast(ticket_id as text)         as ticket_id,
    cast(agent_id as text)          as agent_id,
    cast(agent_id as text)          as summary,
    cast(status as text)            as recommendation_status,
    cast(status as text)            as status,
    cast(agent_id as text)          as recommendation_type,
    (lower(cast(status as text)) = 'accepted')  as is_accepted,
    (lower(cast(status as text)) = 'dismissed') as is_dismissed,
    (lower(cast(status as text)) = 'open')      as is_open,
    created_at
from {{ source('ticketing', 'proactive_recommendations') }}
