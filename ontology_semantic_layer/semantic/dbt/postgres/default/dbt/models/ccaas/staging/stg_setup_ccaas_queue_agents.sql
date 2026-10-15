select
    qa.id as queue_agent_id,
    qa.queue_id,
    qa.user_id,
    q.organization_id,
    qa.handles_calls,
    qa.handles_email,
    qa.handles_chat,
    qa.handles_whatsapp,
    qa.handles_social,
    qa.call_type,
    qa.shift_type,
    qa.created_at
from {{ source('worktual', 'setup_ccaas_queue_agents') }} qa
left join {{ source('worktual', 'setup_ccaas_queues') }} q on qa.queue_id = q.id