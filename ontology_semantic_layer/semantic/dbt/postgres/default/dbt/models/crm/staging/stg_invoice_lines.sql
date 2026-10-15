{{ config(materialized='view') }}

select
    cast(id as text)                    as invoice_line_id,
    cast(invoice_id as text)            as invoice_id,
    cast(product_id as text)            as product_id,
    cast(addon_id as text)              as addon_id,
    cast(organization_id as text)       as organization_id,
    cast(kind as text)                  as line_kind,
    cast(name as text)                  as line_name,
    quantity,
    unit_price,
    tax_percent,
    amount                              as line_amount,
    sort_order,
    created_at,
    updated_at
from {{ source('crm', 'invoice_lines') }}
