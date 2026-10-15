select
    event_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    coalesce(organization_id, 0) as organization_id,
    event_type,
    form_id,
    form_name,
    field_name,
    field_value,
    device,
    country,
    page_path,
    created_at
from {{ source('web_tracking', 'fact_form_events') }}
