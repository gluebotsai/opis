select
    event_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    event_name,
    event_data,
    device,
    country,
    created_at
from {{ ref('stg_custom_events') }}
