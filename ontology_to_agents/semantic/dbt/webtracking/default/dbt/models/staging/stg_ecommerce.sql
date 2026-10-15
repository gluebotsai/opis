-- Daily e-commerce rollup view (states already merged).
select
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
from {{ source('web_tracking', 'ecommerce') }}
