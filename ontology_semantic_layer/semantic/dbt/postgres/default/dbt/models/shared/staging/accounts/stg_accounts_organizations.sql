{{ config(materialized='view') }}

select
    cast(id as text)                    as organization_id,
    cast(business_type as text)         as business_type,
    cast(industry_type as text)         as industry_type,
    cast(company_name as text)          as company_name,
    cast(lifecycle_status as text)      as lifecycle_status,
    cast(country as text)               as country,
    created_at,
    updated_at
from {{ source('accounts', 'organizations') }}
