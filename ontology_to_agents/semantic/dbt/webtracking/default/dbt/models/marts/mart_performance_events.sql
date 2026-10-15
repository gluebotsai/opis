select
    event_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    metric_name,
    metric_value,
    rating,
    page_path,
    device,
    created_at
from {{ ref('stg_performance_events') }}
