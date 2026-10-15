{{ config(materialized='view') }}
-- Agent task grain with assignee display name for SQL agent group_by.
select
    t.*,
    u.user_name as assignee_name
from {{ ref('stg_agent_tasks') }} t
left join {{ ref('stg_ccaas_setup_users') }} u
    on t.assigned_user_id = u.user_id
    and t.organization_id = u.organization_id
