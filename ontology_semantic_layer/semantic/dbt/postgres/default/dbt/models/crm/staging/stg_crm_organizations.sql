{{ config(materialized='view', alias='stg_organizations') }}

select
    organization_id,
    business_type,
    industry_type,
    company_name,
    lifecycle_status,
    country,
    created_at,
    updated_at
from {{ ref('stg_accounts_organizations') }}
