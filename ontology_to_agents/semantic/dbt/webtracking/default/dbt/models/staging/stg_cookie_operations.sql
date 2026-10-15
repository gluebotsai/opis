select
    c.event_id,
    c.session_id,
    c.visitor_id,
    c.website_id,
    coalesce(w.organization_id, 0) as organization_id,
    c.action,
    c.cookie_name,
    c.cookie_value,
    c.expiry_days,
    c.page_path,
    c.created_at
from {{ source('web_tracking', 'fact_cookie_operations') }} c
left join {{ ref('stg_web_sites') }} w on c.website_id = w.website_id
