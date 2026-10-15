{{ config(materialized='view', alias='stg_setup_users') }}

-- Human agent/employee directory — referenced by conversations.assigned_agent_id,
-- setup_ccaas_queue_agents.user_id, agent_tasks.assigned_user_id
select
    id                                  as user_id,
    organization_id,
    employee_id,
    concat(first_name, ' ', last_name) as user_name,
    work_email,
    status,
    team_id,
    primary_language,
    location_id,
    created_at
from {{ source('worktual', 'setup_users') }}
