{{ config(materialized='view') }}

select
    cast(id as text)                    as company_id,
    cast(organization_id as text)       as organization_id,
    cast(parent_company_id as text)     as parent_company_id,
    cast(owner_user_id as text)         as owner_user_id,
    cast(name as text)                  as company_name,
    cast(industry as text)              as company_industry,
    employee_count,
    cast(domain as text)                as domain,
    cast(linkedin_url as text)          as linkedin_url,
    cast(logo_url as text)              as logo_url,
    cast(channel_role as text)          as channel_role,
    (parent_company_id is not null)     as is_franchise_node,
    created_at,
    updated_at
from {{ source('crm', 'companies') }}
