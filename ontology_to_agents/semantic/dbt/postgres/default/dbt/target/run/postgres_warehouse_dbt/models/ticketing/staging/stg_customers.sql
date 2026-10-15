
  create view "worktual_bigint"."ticketing_staging"."stg_customers__dbt_tmp"
    
    
  as (
    

with ticket_stats as (
    select
        cast(customer_id as text)       as customer_id,
        cast(organization_id as text)   as organization_id,
        count(*)                        as total_tickets,
        max(created_at)                 as last_ticket_at,
        max(customer_name)              as ticket_customer_name,
        max(customer_email)             as ticket_customer_email
    from "worktual_bigint"."ticketing"."tickets"
    group by 1, 2
)
select
    cast(cp.id as text)                                       as customer_id,
    cast(cp.organization_id as text)                          as organization_id,
    cast(coalesce(ts.ticket_customer_name, cp.cdp_id) as text) as customer_name,
    cast(coalesce(ts.ticket_customer_email, '') as text)      as customer_email,
    cast(cp.account_id as text)                               as account_id,
    cast(cp.external_id as text)                              as external_id,
    cast(cp.status as text)                                   as customer_status,
    cast(cp.status as text)                                   as status,
    coalesce(ts.total_tickets, cp.total_tickets, 0)           as total_tickets,
    coalesce(ts.last_ticket_at, cp.created_at)                 as last_ticket_at,
    cp.created_at,
    cp.updated_at
from "worktual_bigint"."ticketing"."contact_profile" cp
left join ticket_stats ts
    on cast(cp.id as text) = ts.customer_id
    and cast(cp.organization_id as text) = ts.organization_id
  );