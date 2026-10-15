
  create view "worktual_bigint"."crm_marts"."mart_contact_order_summary__dbt_tmp"
    
    
  as (
    

-- One row per contact who has placed at least one order. Pre-aggregates
-- order_count so "2+ orders" (repeat customer) can be expressed as a plain
-- boolean flag and counted with count_distinct — MetricFlow ratio/simple
-- metrics can't express a HAVING COUNT(...) >= 2 clause directly on the
-- order grain, so that aggregation has to happen here instead.
select
    o.contact_id,
    o.organization_id,
    min(o.created_at)                as first_order_at,
    max(o.created_at)                as most_recent_order_at,
    count(distinct o.order_id)       as order_count,
    sum(o.total)                     as lifetime_order_value,
    case when count(distinct o.order_id) >= 2 then true else false end as is_repeat_customer
from "worktual_bigint"."crm_marts"."mart_orders" o
where o.contact_id is not null
group by o.contact_id, o.organization_id
  );