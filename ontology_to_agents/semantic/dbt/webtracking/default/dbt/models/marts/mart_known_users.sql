select
    concat(toString(website_id), ':', user_id, ':', visitor_id) as known_user_key,
    website_id,
    organization_id,
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
    updated_at,
    if(email != '', 1, 0) as has_email,
    if(phone != '', 1, 0) as has_phone
from {{ ref('stg_known_users') }}
