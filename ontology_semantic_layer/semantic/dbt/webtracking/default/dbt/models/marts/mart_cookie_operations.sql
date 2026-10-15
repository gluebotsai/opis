select
    event_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    action,
    cookie_name,
    cookie_value,
    expiry_days,
    page_path,
    created_at
from {{ ref('stg_cookie_operations') }}
