

select
    id as team_id,
    organization_id,
    name as team_name,
    status,
    created_at
from "worktual_bigint"."accounts"."setup_teams"