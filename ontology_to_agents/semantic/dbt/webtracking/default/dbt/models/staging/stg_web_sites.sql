select
    website_id,
    organization_id,
    website_url,
    site_type,
    status,
    created_at,
    updated_at
from {{ source('web_tracking', 'dim_websites') }} FINAL
