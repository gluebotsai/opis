
  create view "worktual_bigint"."crm_staging"."stg_deals__dbt_tmp"
    
    
  as (
    

select
    cast(id as text)                    as deal_id,
    cast(organization_id as text)       as organization_id,
    cast(company_id as text)            as company_id,
    cast(location_id as text)           as location_id,
    cast(contact_id as text)            as contact_id,
    cast(owner_user_id as text)         as owner_user_id,
    cast(title as text)                 as deal_title,
    cast(stage as text)                 as stage,
    amount,
    cast(contact_name as text)          as contact_name,
    cast(contact_email as text)         as contact_email,
    cast(notes as text)                 as notes,
    expected_close_date,
    cast(lost_reason as text)           as lost_reason,
    cast(forecast_category as text)     as forecast_category,
    forecast_confidence_percent,
    closed_at,
    created_at,
    updated_at,
    case
        when cast(stage as text) = 'closed_won' then 'won'
        when cast(stage as text) = 'closed_lost' then 'lost'
        else 'open'
    end                                 as deal_status_proxy,
    (cast(stage as text) not in ('closed_won','closed_lost')) as is_open,
    (cast(stage as text) = 'closed_won')               as is_won,
    (cast(stage as text) = 'closed_lost')              as is_lost,
    (cast(stage as text) in ('closed_won','closed_lost')) as is_closed,
    case when cast(stage as text) = 'closed_won' and closed_at is not null
         then extract(epoch from (closed_at - created_at)) / 86400.0
    end                                 as sales_cycle_days
from "worktual_bigint"."crm"."deals"
  );