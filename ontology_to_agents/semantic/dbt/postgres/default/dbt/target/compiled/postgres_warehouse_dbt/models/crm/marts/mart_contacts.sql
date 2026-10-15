

select
    c.contact_id,
    c.contact_profile_id,
    c.organization_id,
    org.business_type,
    c.company_id,
    co.company_name,
    c.location_id,
    c.owner_user_id,
    u.full_name          as owner_name,
    c.lifecycle_stage,
    c.lead_source,
    c.lead_status,
    c.disqualify_reason,
    c.bant_budget,
    c.bant_authority,
    c.bant_need,
    c.bant_timeline,
    c.is_mql_proxy,
    c.converted_deal_id,
    c.crm_status,
    ls.lead_score,
    ls.lead_grade,
    ls.lead_band,
    ls.fit_score,
    ls.intent_score,
    ls.scored_at,
    c.created_at,
    c.updated_at
from "worktual_bigint"."crm_staging"."stg_contact_profiles" c
left join "worktual_bigint"."crm_staging"."stg_setup_users" u
    on c.owner_user_id = u.user_id
    and c.organization_id = u.organization_id
left join "worktual_bigint"."crm_staging"."stg_organizations" org
    on c.organization_id = org.organization_id
left join "worktual_bigint"."crm_marts"."mart_companies" co
    on c.company_id = co.company_id
    and c.organization_id = co.organization_id
left join "worktual_bigint"."crm_staging"."stg_lead_scoring_jobs" ls
    on c.contact_id = ls.contact_id
    and c.organization_id = ls.organization_id