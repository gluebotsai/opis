{{ config(materialized='view') }}

select
    cast(id as text)                    as product_id,
    cast(organization_id as text)       as organization_id,
    cast(name as text)                  as product_name,
    cast(sku as text)                   as sku,
    cast(category as text)              as product_category,
    cast(subcategory as text)           as product_subcategory,
    cast(brand as text)                 as product_brand,
    price                               as list_price,
    cast(currency as text)              as currency,
    cast(status as text)                as product_status,
    cast(billing_type as text)          as billing_type,
    cast(billing_frequency as text)     as billing_frequency,
    cast(unit_of_measure as text)       as unit_of_measure,
    cast(product_type as text)          as product_type,
    max_discount_percent,
    stock_on_hand,
    (cast(status as text) = 'active')   as is_active,
    created_at,
    updated_at
from {{ source('inventory', 'products') }}
