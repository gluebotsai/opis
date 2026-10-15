{{ config(materialized='view') }}

select
    cast(identity_id as text)           as identity_id,
    cast(cdp_id as text)                as contact_id,
    cast(organization_id as text)       as organization_id,
    cast(key_type as text)              as key_type,
    cast(key_value as text)             as key_value,
    cast(source_system as text)         as source_system,
    confidence_score,
    verified,
    created_at
from {{ source('cdp', 'identity_keys') }}
