

select
    cast(cdp_id as text)                as contact_id,
    cast(organization_id as text)       as organization_id,
    cast(first_name as text)            as first_name,
    cast(last_name as text)             as last_name,
    cast(company as text)               as company,
    cast(city as text)                  as city,
    cast(contact_type as text)          as contact_type,
    cast(acquisition_channel as text)   as acquisition_channel,
    created_at,
    updated_at,
    first_seen_at,
    last_seen_at
from "worktual_bigint"."cdp"."customer_profile"