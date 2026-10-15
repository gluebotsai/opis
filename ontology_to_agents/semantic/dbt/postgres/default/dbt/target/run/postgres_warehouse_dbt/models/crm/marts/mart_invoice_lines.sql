
  create view "worktual_bigint"."crm_marts"."mart_invoice_lines__dbt_tmp"
    
    
  as (
    

select
    il.invoice_line_id,
    il.invoice_id,
    il.organization_id,
    i.business_type,
    il.line_kind,
    il.product_id,
    p.product_name,
    p.sku                  as product_sku,
    p.product_category,
    il.addon_id,
    il.line_name,
    il.quantity,
    il.unit_price,
    il.tax_percent,
    il.line_amount,
    i.invoice_status,
    i.deal_id,
    i.company_id,
    il.sort_order,
    il.created_at,
    il.updated_at
from "worktual_bigint"."crm_staging"."stg_invoice_lines" il
left join "worktual_bigint"."crm_marts"."mart_invoices" i
    on il.invoice_id = i.invoice_id
    and il.organization_id = i.organization_id
left join "worktual_bigint"."crm_staging"."stg_products" p
    on il.product_id = p.product_id
    and il.organization_id = p.organization_id
  );