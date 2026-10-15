{{ config(materialized='view') }}

select
    ct.contract_id,
    ct.organization_id,
    org.business_type,
    ct.company_id,
    co.company_name,
    co.channel_role,
    ct.deal_id,
    ct.contract_title,
    ct.starts_at,
    ct.ends_at,
    ct.arr,
    ct.is_expired,
    ct.is_renewal_due_90d,
    ct.is_renewed,
    ct.renew_deal_id,
    ct.renewal_reminded_at,
    ct.created_at,
    ct.updated_at
from {{ ref('stg_contracts') }} ct
left join {{ ref('mart_companies') }} co
    on ct.company_id = co.company_id
    and ct.organization_id = co.organization_id
left join {{ ref('stg_crm_organizations') }} org
    on ct.organization_id = org.organization_id
