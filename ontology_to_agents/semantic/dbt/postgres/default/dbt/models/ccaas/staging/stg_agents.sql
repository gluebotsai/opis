-- models/staging/stg_agents.sql
select
    id as agent_id,
    organization_id,
    display_name as agent_name,
    email,
    status,
    created_at
from {{ source('contact_center', 'agents') }}