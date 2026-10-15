select
    concat(toString(website_id), ':', toString(event_date)) as ecommerce_day_key,
    website_id,
    event_date,
    product_views,
    cart_adds,
    cart_removes,
    wishlist_adds,
    wishlist_removes,
    checkout_starts,
    product_engaged_visitors,
    purchases,
    purchase_revenue,
    refunds
from {{ ref('stg_ecommerce') }}
