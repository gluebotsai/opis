{{ config(materialized='view') }}

select
    cast(id as text)                    as contract_id,
    cast(organization_id as text)       as organization_id,
    cast(company_id as text)            as company_id,
    cast(deal_id as text)               as deal_id,
    cast(renew_deal_id as text)         as renew_deal_id,
    cast(title as text)                 as contract_title,
    starts_at,
    ends_at,
    arr,
    renewal_reminded_at,
    (ends_at < current_timestamp)       as is_expired,
    (ends_at >= current_timestamp and ends_at <= current_timestamp + interval '90 days') as is_renewal_due_90d,
    (renew_deal_id is not null)         as is_renewed,
    created_at,
    updated_at
from {{ source('crm', 'contracts') }}
