select
    conversion_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    conversion_type,
    product_id,
    value,
    currency,
    device,
    country,
    utm_source,
    utm_campaign,
    created_at
from {{ ref('stg_conversion_events') }}
