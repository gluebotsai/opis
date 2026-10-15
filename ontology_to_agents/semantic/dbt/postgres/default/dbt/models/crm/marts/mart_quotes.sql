{{ config(materialized='view') }}

select
    q.quote_id,
    q.organization_id,
    d.business_type,
    q.deal_id,
    q.proposal_id,
    q.quote_number,
    q.version,
    q.quote_status,
    q.is_accepted,
    q.currency,
    q.subtotal,
    q.discount_pct,
    q.total,
    q.valid_until,
    q.sent_at,
    q.accepted_at,
    q.created_by_user_id,
    u.full_name          as created_by_name,
    d.stage              as deal_stage,
    d.is_won              as deal_is_won,
    d.owner_user_id       as deal_owner_user_id,
    d.owner_name,
    q.created_at,
    q.updated_at
from {{ ref('stg_quotes') }} q
left join {{ ref('mart_deals') }} d
    on q.deal_id = d.deal_id
    and q.organization_id = d.organization_id
left join {{ ref('stg_crm_setup_users') }} u
    on q.created_by_user_id = u.user_id
    and q.organization_id = u.organization_id