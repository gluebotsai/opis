{{ config(materialized='view') }}

select
    cast(id as text)                    as location_id,
    cast(company_id as text)            as company_id,
    cast(organization_id as text)       as organization_id,
    cast(owner_user_id as text)         as owner_user_id,
    cast(name as text)                  as location_name,
    cast(type as text)                  as location_type,
    cast(address as text)               as address,
    cast(city as text)                  as city,
    cast(industry as text)              as industry,
    employee_count,
    created_at,
    updated_at
from {{ source('crm', 'company_locations') }}
