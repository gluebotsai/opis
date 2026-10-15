select
    id as capacity_id,
    organization_id,
    agent_id,
    channel,
    max_concurrency,
    reserved_count,
    active_count,
    updated_at
from {{ source('contact_center', 'agent_capacity') }}


