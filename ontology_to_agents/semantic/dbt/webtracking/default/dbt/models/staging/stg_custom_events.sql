select
    event_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    coalesce(organization_id, 0) as organization_id,
    event_name,
    event_data,
    device,
    country,
    created_at
from {{ source('web_tracking', 'fact_custom_events') }}
