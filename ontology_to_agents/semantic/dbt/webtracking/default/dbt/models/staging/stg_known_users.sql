select
    website_id,
    coalesce(organization_id, 0) as organization_id,
    user_id,
    visitor_id,
    email,
    phone,
    first_name,
    last_name,
    method,
    last_event_type,
    traits_json,
    first_identified_at,
    last_identified_at,
    updated_at
from {{ source('web_tracking', 'dim_known_users') }} FINAL
