{{ config(materialized='view') }}

select
    c.company_id,
    c.organization_id,
    org.business_type,
    c.company_name,
    c.company_industry,
    c.employee_count,
    c.domain,
    c.channel_role,
    c.is_franchise_node,
    c.parent_company_id,
    pco.company_name      as parent_company_name,
    c.owner_user_id,
    u.full_name           as owner_name,
    coalesce(loc.location_count, 0) as location_count,
    c.created_at,
    c.updated_at
from {{ ref('stg_companies') }} c
left join {{ ref('stg_companies') }} pco
    on c.parent_company_id = pco.company_id
    and c.organization_id = pco.organization_id
left join {{ ref('stg_crm_setup_users') }} u
    on c.owner_user_id = u.user_id
    and c.organization_id = u.organization_id
left join {{ ref('stg_crm_organizations') }} org
    on c.organization_id = org.organization_id
left join (
    select
        company_id,
        organization_id,
        count(*) as location_count
    from {{ ref('stg_company_locations') }}
    group by 1, 2
) loc
    on c.company_id = loc.company_id
    and c.organization_id = loc.organization_id
