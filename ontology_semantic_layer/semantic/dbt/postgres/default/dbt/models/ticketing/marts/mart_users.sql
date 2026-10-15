{{ config(materialized='view') }}
select
    user_id,
    organization_id,
    user_name,
    email,
    role,
    status,
    is_active,
    myaccount_user_id,
    last_login_at,
    created_at,
    updated_at
from {{ ref('stg_users') }}
