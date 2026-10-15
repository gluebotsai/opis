select
    visitor_id,
    website_id,
    coalesce(organization_id, 0) as organization_id,
    user_id,
    anonymous_id,
    first_seen_at,
    last_seen_at,
    total_sessions,
    total_pageviews,
    country,
    if(user_id != '', 1, 0) as is_identified_flag,
    created_at,
    updated_at
from {{ source('web_tracking', 'dim_visitors') }} FINAL
