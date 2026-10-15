{{ config(materialized='view') }}

select
    cast(id as text)                as account_id,
    cast(organization_id as text)   as organization_id,
    cast(name as text)              as account_name,
    cast(status as text)            as account_status,
    cast(status as text)            as status,
    created_at,
    updated_at
from {{ source('ticketing', 'ticketing_accounts') }}
