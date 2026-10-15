{{ config(materialized='view') }}

select
    d.deal_id,
    d.organization_id,
    org.business_type,
    d.company_id,
    co.company_name,
    d.location_id,
    d.contact_id,
    d.owner_user_id,
    u.full_name          as owner_name,
    u.team_id            as owner_team_id,
    d.deal_title,
    d.stage,
    d.deal_status_proxy,
    d.is_open,
    d.is_won,
    d.is_lost,
    d.is_closed,
    d.amount,
    d.contact_name,
    d.contact_email,
    d.expected_close_date,
    d.lost_reason,
    d.forecast_category,
    d.forecast_confidence_percent,
    d.sales_cycle_days,
    d.closed_at,
    d.created_at,
    d.updated_at
from {{ ref('stg_deals') }} d
left join {{ ref('stg_crm_setup_users') }} u
    on d.owner_user_id = u.user_id
    and d.organization_id = u.organization_id
left join {{ ref('stg_crm_organizations') }} org
    on d.organization_id = org.organization_id
left join {{ ref('mart_companies') }} co
    on d.company_id = co.company_id
    and d.organization_id = co.organization_id
