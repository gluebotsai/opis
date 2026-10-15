{{ config(materialized='view') }}

select
    ql.quote_line_id,
    ql.quote_id,
    ql.organization_id,
    q.business_type,
    ql.product_id,
    p.product_name,
    p.sku                  as product_sku,
    p.product_category,
    p.product_subcategory,
    p.product_brand,
    ql.line_name,
    ql.quantity,
    ql.unit_price,
    ql.line_amount,
    q.quote_status,
    q.deal_id,
    q.deal_stage,
    q.owner_name,
    ql.sort_order,
    ql.created_at,
    ql.updated_at
from {{ ref('stg_quote_lines') }} ql
left join {{ ref('mart_quotes') }} q
    on ql.quote_id = q.quote_id
    and ql.organization_id = q.organization_id
left join {{ ref('stg_products') }} p
    on ql.product_id = p.product_id
    and ql.organization_id = p.organization_id