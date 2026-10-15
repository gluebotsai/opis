

select
    cast(id as text)                    as deal_activity_id,
    cast(deal_id as text)               as deal_id,
    cast(organization_id as text)       as organization_id,
    cast(created_by_user_id as text)    as created_by_user_id,
    cast(type as text)                  as activity_type,
    cast(subject as text)               as subject,
    cast(body as text)                  as body,
    due_at,
    completed_at,
    (completed_at is not null)          as is_completed,
    created_at,
    updated_at
from "worktual_bigint"."crm"."deal_activities"