select
    conversion_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    coalesce(organization_id, 0) as organization_id,
    conversion_type,
    product_id,
    value,
    currency,
    device,
    country,
    utm_source,
    utm_campaign,
    created_at
from {{ source('web_tracking', 'fact_conversion_events') }}
