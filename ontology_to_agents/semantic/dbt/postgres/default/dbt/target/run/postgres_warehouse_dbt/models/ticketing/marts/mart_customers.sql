
  create view "worktual_bigint"."ticketing_marts"."mart_customers__dbt_tmp"
    
    
  as (
    
select
    customer_id,
    organization_id,
    account_id,
    external_id,
    customer_name,
    customer_email,
    status,
    (lower(status) = 'active') as is_active,
    total_tickets,
    created_at,
    updated_at
from "worktual_bigint"."ticketing_staging"."stg_customers"
  );