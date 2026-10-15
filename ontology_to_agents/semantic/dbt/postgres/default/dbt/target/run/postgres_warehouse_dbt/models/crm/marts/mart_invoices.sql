
  create view "worktual_bigint"."crm_marts"."mart_invoices__dbt_tmp"
    
    
  as (
    

select
    i.invoice_id,
    i.organization_id,
    org.business_type,
    i.order_id,
    i.company_id,
    co.company_name,
    i.deal_id,
    i.invoice_number,
    i.invoice_status,
    i.is_outstanding,
    i.is_paid,
    i.currency,
    i.total,
    i.discount_amount,
    i.tax_amount,
    i.due_at,
    i.paid_at,
    i.issue_date,
    i.days_to_pay,
    i.created_by_user_id,
    u.full_name          as created_by_name,
    i.created_at,
    i.updated_at
from "worktual_bigint"."crm_staging"."stg_invoices" i
left join "worktual_bigint"."crm_staging"."stg_setup_users" u
    on i.created_by_user_id = u.user_id
    and i.organization_id = u.organization_id
left join "worktual_bigint"."crm_staging"."stg_organizations" org
    on i.organization_id = org.organization_id
left join "worktual_bigint"."crm_marts"."mart_companies" co
    on i.company_id = co.company_id
    and i.organization_id = co.organization_id
  );