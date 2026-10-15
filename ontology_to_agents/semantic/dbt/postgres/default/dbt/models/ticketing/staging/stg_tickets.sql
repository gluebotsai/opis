{{ config(materialized='view') }}

select
    cast(id as text)                as ticket_id,
    cast(organization_id as text)   as organization_id,
    cast(ticket_number as text)     as ticket_number,
    cast(subject as text)           as subject,
    cast(description as text)       as description,
    cast(status as text)            as status,
    cast(priority as text)          as priority,
    cast(channel as text)           as channel,
    cast(category as text)          as category,
    cast(skill as text)             as skill,
    cast(customer_id as text)       as customer_id,
    cast(customer_name as text)     as customer_name,
    cast(customer_email as text)    as customer_email,
    cast(customer_phone as text)    as customer_phone,
    cast(assignee_id as text)       as assignee_id,
    cast(assignee_name as text)     as assignee_name,
    cast(resolver_id as text)       as resolver_id,
    cast(resolver_name as text)     as resolver_name,
    cast(queue_id as text)          as queue_id,
    cast(queue_name as text)        as queue_name,
    cast(created_by_id as text)     as created_by_id,
    cast(created_by_name as text)   as created_by_name,
    cast(ai_summary as text)        as ai_summary,
    csat_score                      as csat_rating,
    csat_score,
    (csat_score is not null)        as has_csat_score,
    (csat_score is not null)        as has_csat_rating,
    due_at,
    first_response_at,
    resolved_at,
    csat_rated_at,
    created_at,
    updated_at,
    (lower(cast(status as text)) = 'resolved')                  as is_resolved,
    (lower(cast(status as text)) = 'open')                      as is_open,
    (lower(cast(status as text)) not in ('closed', 'resolved')) as is_pending,
    (first_response_at is not null) as has_first_response,
    case when lower(cast(status as text)) = 'overdue' then true else false end as is_breached_proxy,
    case when resolved_at is not null and created_at is not null
         then extract(epoch from (resolved_at - created_at)) / 3600.0
    end                             as resolution_hours,
    case when first_response_at is not null and created_at is not null
         then extract(epoch from (first_response_at - created_at)) / 3600.0
    end                             as first_response_hours,
    -- appended so CREATE OR REPLACE VIEW can add the column
    (lower(cast(status as text)) = 'closed')                    as is_closed
from {{ source('ticketing', 'tickets') }}