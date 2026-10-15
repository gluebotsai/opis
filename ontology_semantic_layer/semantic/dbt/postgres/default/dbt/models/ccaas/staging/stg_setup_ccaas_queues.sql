-- Real queue definitions (replaces earlier placeholder queue source)
select
    id as queue_id,
    organization_id,
    name as queue_name,
    team_id,
    business_hours_id,
    status,
    created_at,
    updated_at
from {{ source('worktual', 'setup_ccaas_queues') }}
