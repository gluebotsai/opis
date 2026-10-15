{{ config(materialized='view') }}

select
    cast(id as text)                    as order_id,
    cast(organization_id as text)       as organization_id,
    cast(deal_id as text)               as deal_id,
    cast(quote_id as text)              as quote_id,
    cast(company_id as text)            as company_id,
    cast(contact_id as text)            as contact_id,
    cast(created_by_user_id as text)    as created_by_user_id,
    cast(number as text)                as order_number,
    cast(status as text)                as order_status,
    cast(currency as text)              as currency,
    total,
    confirmed_at,
    created_at,
    updated_at
from {{ source('crm', 'sales_orders') }}
