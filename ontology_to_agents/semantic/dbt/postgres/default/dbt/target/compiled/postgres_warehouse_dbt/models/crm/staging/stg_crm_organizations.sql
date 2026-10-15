

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