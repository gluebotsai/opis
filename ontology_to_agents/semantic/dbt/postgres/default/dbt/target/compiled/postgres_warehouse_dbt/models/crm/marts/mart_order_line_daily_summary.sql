

-- One row per organization_id x day. Pre-aggregates units, revenue, and
-- distinct product counts for `agg: average` measures.

select
    organization_id,
    business_type,
    date_trunc('day', created_at)          as day,
    sum(quantity)                            as units_sold_sum,
    sum(line_amount)                         as order_line_revenue_sum,
    count(distinct product_id)               as distinct_products_sold
from "worktual_bigint"."crm_marts"."mart_order_lines"
group by 1, 2, 3