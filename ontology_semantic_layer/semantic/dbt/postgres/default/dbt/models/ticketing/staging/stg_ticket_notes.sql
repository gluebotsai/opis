{{ config(materialized='view') }}

select
    cast(id as text)                as ticket_note_id,
    cast(organization_id as text)   as organization_id,
    cast(ticket_id as text)         as ticket_id,
    cast(author_id as text)         as author_id,
    cast(author_name as text)       as author_name,
    cast(visibility as text)        as visibility,
    (lower(cast(visibility as text)) = 'internal') as is_internal_note,
    created_at
from {{ source('ticketing', 'ticket_notes') }}
