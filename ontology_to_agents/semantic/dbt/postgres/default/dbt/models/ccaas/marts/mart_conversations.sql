{{ config(materialized='view') }}
-- Conversation grain mart: staging flags + denormalized queue/agent names for group_by.
select
    c.*,
    q.queue_name,
    a.agent_name as assigned_agent_name
from {{ ref('stg_conversations') }} c
left join {{ ref('stg_setup_ccaas_queues') }} q
    on c.queue_id = q.queue_id
    and c.organization_id = q.organization_id
left join {{ ref('stg_agents') }} a
    on c.assigned_agent_id = a.agent_id
    and c.organization_id = a.organization_id
