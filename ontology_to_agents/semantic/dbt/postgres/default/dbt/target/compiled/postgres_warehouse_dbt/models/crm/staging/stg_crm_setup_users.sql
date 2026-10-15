

select
    user_id,
    organization_id,
    team_id,
    first_name,
    last_name,
    cast(first_name || ' ' || last_name as text) as full_name,
    work_email,
    status                                       as user_status
from "worktual_bigint"."shared_staging"."stg_accounts_setup_users"