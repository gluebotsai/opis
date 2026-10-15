{{ config(materialized='view') }}

select
    cast(id as text)                as ticket_status_id,
    cast(organization_id as text)   as organization_id,
    cast(status as text)            as status,
    cast(status as text)            as status_name,
    cast(display_name as text)      as status_display_name,
    cast(display_name as text)      as display_name,
    (is_system is true)             as is_system,
    (is_terminal is true)           as is_terminal,
    (active is true)                as is_active,
    (active is true)                as active,
    sort_order,
    created_at
from {{ source('ticketing', 'ticket_statuses') }}
