{{ config(materialized='view') }}

select
    cast(id as text)                    as contact_activity_id,
    cast(contact_id as text)            as contact_id,
    cast(organization_id as text)       as organization_id,
    cast(created_by_user_id as text)    as created_by_user_id,
    cast(assignee_user_id as text)      as assignee_user_id,
    cast(type as text)                  as activity_type,
    cast(subject as text)               as subject,
    cast(body as text)                  as body,
    due_at,
    completed_at,
    cast(folder as text)                as folder,
    cast(email_direction as text)       as email_direction,
    cast(task_status as text)           as task_status,
    (completed_at is not null)          as is_completed,
    (type = 'task')                     as is_task,
    created_at,
    updated_at
from {{ source('crm', 'contact_activities') }}
