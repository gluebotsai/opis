
  create view "worktual_bigint"."crm_staging"."stg_quotes__dbt_tmp"
    
    
  as (
    

select
    cast(id as text)                    as quote_id,
    cast(organization_id as text)       as organization_id,
    cast(deal_id as text)               as deal_id,
    cast(proposal_id as text)           as proposal_id,
    cast(created_by_user_id as text)    as created_by_user_id,
    cast(number as text)                as quote_number,
    cast(version as text)               as version,
    cast(status as text)                as quote_status,
    cast(currency as text)              as currency,
    subtotal,
    discount_pct,
    total,
    valid_until,
    sent_at,
    accepted_at,
    (cast(status as text) = 'accepted') as is_accepted,
    created_at,
    updated_at
from "worktual_bigint"."crm"."quotes"
  );