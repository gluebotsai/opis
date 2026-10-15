{{ config(materialized='view') }}

select
    cast(id as text)                as proactive_audit_id,
    cast(organization_id as text)   as organization_id,
    cast(ticket_id as text)         as ticket_id,
    cast(agent_id as text)          as agent_id,
    cast(event_id as text)          as event_id,
    cast(decision as text)          as decision,
    cast(decision as text)          as action,
    cast(tool_name as text)         as actor,
    cast(reason as text)            as reason,
    created_at
from {{ source('ticketing', 'proactive_audit') }}
