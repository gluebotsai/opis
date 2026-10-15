{{ config(materialized='view') }}

select
    cast(id as text)                    as invoice_id,
    cast(organization_id as text)       as organization_id,
    cast(order_id as text)              as order_id,
    cast(company_id as text)            as company_id,
    cast(deal_id as text)               as deal_id,
    cast(created_by_user_id as text)    as created_by_user_id,
    cast(number as text)                as invoice_number,
    cast(status as text)                as invoice_status,
    cast(currency as text)              as currency,
    total,
    discount_amount,
    tax_amount,
    due_at,
    paid_at,
    issue_date,
    (cast(status as text) in ('sent','overdue'))      as is_outstanding,
    (cast(status as text) = 'paid')                   as is_paid,
    case when cast(status as text) = 'paid' and paid_at is not null and issue_date is not null
         then extract(epoch from (paid_at - issue_date)) / 86400.0
    end                                 as days_to_pay,
    created_at,
    updated_at
from {{ source('crm', 'invoices') }}
