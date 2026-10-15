
  create view "worktual_bigint"."crm_marts"."mart_order_lines__dbt_tmp"
    
    
  as (
    

select
    ol.order_line_id,
    ol.order_id,
    ol.organization_id,
    o.business_type,
    ol.product_id,
    p.product_name,
    p.sku                  as product_sku,
    p.product_category,
    p.product_subcategory,
    p.product_brand,
    p.billing_type          as product_billing_type,
    ol.line_name,
    ol.quantity,
    ol.unit_price,
    ol.line_amount,
    o.order_status,
    o.company_id,
    co.company_name,
    o.contact_id,
    o.created_by_user_id,
    o.created_by_name,
    ol.sort_order,
    ol.created_at,
    ol.updated_at
from "worktual_bigint"."crm_staging"."stg_order_lines" ol
left join "worktual_bigint"."crm_marts"."mart_orders" o
    on ol.order_id = o.order_id
    and ol.organization_id = o.organization_id
left join "worktual_bigint"."crm_staging"."stg_products" p
    on ol.product_id = p.product_id
    and ol.organization_id = p.organization_id
left join "worktual_bigint"."crm_marts"."mart_companies" co
    on o.company_id = co.company_id
    and ol.organization_id = co.organization_id
  );