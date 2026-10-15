

select
    cast(id as text)                    as team_id,
    cast(organization_id as text)       as organization_id,
    cast(name as text)                  as name,
    cast(description as text)           as description,
    cast(status as text)                as status,
    created_at,
    updated_at
from "worktual_bigint"."accounts"."setup_teams"