select
    event_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    coalesce(organization_id, 0) as organization_id,
    metric_name,
    metric_value,
    rating,
    page_path,
    device,
    created_at
from {{ source('web_tracking', 'fact_performance_events') }}
