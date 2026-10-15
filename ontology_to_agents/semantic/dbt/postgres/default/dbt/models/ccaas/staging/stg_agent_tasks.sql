select
    id as task_id,
    organization_id,
    assigned_user_id,
    task_type,
    status,
    priority,
    channel,
    due_at,
    completed_at,
    dismissed_at,
    created_at
from {{ source('contact_center', 'agent_tasks') }}

