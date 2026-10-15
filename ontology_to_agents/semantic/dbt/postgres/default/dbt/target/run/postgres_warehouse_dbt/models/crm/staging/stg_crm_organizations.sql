
  create view "worktual_bigint"."crm_staging"."stg_organizations__dbt_tmp"
    
    
  as (
    

select
    organization_id,
    business_type,
    industry_type,
    company_name,
    lifecycle_status,
    country,
    created_at,
    updated_at
from "worktual_bigint"."shared_staging"."stg_accounts_organizations"
  );