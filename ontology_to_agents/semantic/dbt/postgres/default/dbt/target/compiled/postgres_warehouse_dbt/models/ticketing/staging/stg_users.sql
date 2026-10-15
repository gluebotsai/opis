

select
    cast(a.id as text)                                                         as user_id,
    cast(a.organization_id as text)                                            as organization_id,
    cast(coalesce(u.first_name || ' ' || u.last_name, a.support_email) as text) as user_name,
    cast(coalesce(a.support_email, u.work_email) as text)                      as email,
    cast(a.role as text)                                                       as role,
    cast(a.status as text)                                                     as status,
    cast(a.setup_user_id as text)                                              as myaccount_user_id,
    a.last_login_at,
    a.two_factor_enabled,
    a.created_at,
    a.updated_at,
    (lower(cast(a.status as text)) = 'active')                                 as is_active
from "worktual_bigint"."ticketing"."agents" a
left join "worktual_bigint"."shared_staging"."stg_accounts_setup_users" u
    on cast(a.setup_user_id as text) = u.user_id