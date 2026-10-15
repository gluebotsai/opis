select
    event_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    error_type,
    message,
    stack,
    page_path,
    device,
    browser,
    created_at
from {{ ref('stg_error_events') }}
