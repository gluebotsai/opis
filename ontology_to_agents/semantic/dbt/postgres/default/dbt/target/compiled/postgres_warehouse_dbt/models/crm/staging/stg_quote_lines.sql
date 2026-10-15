

select
    cast(id as text)                    as quote_line_id,
    cast(quote_id as text)              as quote_id,
    cast(product_id as text)            as product_id,
    cast(organization_id as text)       as organization_id,
    cast(name as text)                  as line_name,
    quantity,
    unit_price,
    amount                              as line_amount,
    sort_order,
    created_at,
    updated_at
from "worktual_bigint"."crm"."quote_lines"