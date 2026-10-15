

select
    cast(id as text)                    as user_id,
    cast(organization_id as text)       as organization_id,
    cast(team_id as text)               as team_id,
    cast(first_name as text)            as first_name,
    cast(last_name as text)             as last_name,
    cast(work_email as text)            as work_email,
    cast(status as text)                as status,
    created_at,
    updated_at
from "worktual_bigint"."accounts"."setup_users"