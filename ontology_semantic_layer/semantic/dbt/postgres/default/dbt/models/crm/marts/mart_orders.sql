{{ config(materialized='view') }}

select
    o.order_id,
    o.organization_id,
    org.business_type,
    o.deal_id,
    o.quote_id,
    o.company_id,
    co.company_name,
    o.contact_id,
    o.order_number,
    o.order_status,
    o.currency,
    o.total,
    o.confirmed_at,
    o.created_by_user_id,
    u.full_name          as created_by_name,
    c.lifecycle_stage     as contact_lifecycle_stage,
    c.owner_user_id        as contact_owner_user_id,
    c.owner_name           as contact_owner_name,
    o.created_at,
    o.updated_at
from {{ ref('stg_sales_orders') }} o
left join {{ ref('mart_contacts') }} c
    on o.contact_id = c.contact_id
    and o.organization_id = c.organization_id
left join {{ ref('stg_crm_setup_users') }} u
    on o.created_by_user_id = u.user_id
    and o.organization_id = u.organization_id
left join {{ ref('stg_crm_organizations') }} org
    on o.organization_id = org.organization_id
left join {{ ref('mart_companies') }} co
    on o.company_id = co.company_id
    and o.organization_id = co.organization_id