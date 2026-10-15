{{ config(materialized='view') }}

select
    cast(id as text)                as notification_id,
    cast(organization_id as text)   as organization_id,
    cast(user_id as text)           as user_id,
    cast(ticket_id as text)         as ticket_id,
    cast(kind as text)              as notification_kind,
    cast(kind as text)              as kind,
    cast(title as text)             as notification_title,
    cast(title as text)             as title,
    cast(message as text)           as message,
    cast(customer_name as text)     as customer_name,
    (is_read is true)               as is_read,
    created_at
from {{ source('ticketing', 'notifications') }}
