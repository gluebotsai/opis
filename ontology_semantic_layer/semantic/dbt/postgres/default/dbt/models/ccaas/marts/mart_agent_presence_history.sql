{{ config(materialized='view') }}
-- Presence interval grain with agent display name for occupancy reporting.
select
    p.*,
    a.agent_name
from {{ ref('stg_agent_presence_history') }} p
left join {{ ref('stg_agents') }} a
    on p.agent_id = a.agent_id
    and p.organization_id = a.organization_id
