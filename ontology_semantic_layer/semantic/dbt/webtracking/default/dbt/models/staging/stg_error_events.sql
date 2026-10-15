select
    event_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    coalesce(organization_id, 0) as organization_id,
    error_type,
    message,
    stack,
    page_path,
    device,
    browser,
    created_at
from {{ source('web_tracking', 'fact_error_events') }}
