
  create view "worktual_bigint"."crm_staging"."stg_contact_profiles__dbt_tmp"
    
    
  as (
    

select
    cast(cp.id as text)                        as contact_profile_id,
    cast(coalesce(cp.account_contact_id, cust.contact_id) as text) as contact_id,
    cast(cust.organization_id as text)         as organization_id,
    cast(cp.company_id as text)                as company_id,
    cast(cp.location_id as text)               as location_id,
    cast(cp.owner_user_id as text)             as owner_user_id,
    cast(cp.converted_deal_id as text)         as converted_deal_id,
    cast(cust.contact_type as text)            as lifecycle_stage,
    cast(cp.lead_source as text)               as lead_source,
    cast(cp.lead_status as text)               as lead_status,
    cast(cp.disqualify_reason as text)         as disqualify_reason,
    cp.bant_budget,
    cp.bant_authority,
    cp.bant_need,
    cp.bant_timeline,
    (cp.bant_budget is true
        and cp.bant_authority is true
        and cp.bant_need is true
        and cp.bant_timeline is true)          as is_mql_proxy,
    cast(cp.crm_status as text)                as crm_status,
    cp.created_at,
    cp.updated_at
from "worktual_bigint"."shared_staging"."stg_cdp_customer_profile" cust
left join "worktual_bigint"."crm"."contact_profiles" cp
    on cast(cp.account_contact_id as text) = cust.contact_id
    and cast(cp.organization_id as text) = cust.organization_id
  );