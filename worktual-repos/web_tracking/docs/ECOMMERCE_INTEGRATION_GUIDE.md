# E-commerce integration guide

Wire the Worktual Web Tracking SDK on storefronts so **Product Analytics** in the dashboard shows views, cart, wishlist, checkout, purchases, trending products, and engaged visitors.

Generic metrics (total visitors, new vs returning, bounce, top pages) stay on **Dashboard**. E-commerce sites get a **Product Analytics** nav item instead of **Forms** when My Accounts registers `site_type: ecommerce`.

## 1. Site registration

In My Accounts, set `site_type` to `ecommerce` for the website. The dashboard JWT includes `features.product_analytics: true`.

## 2. SDK snippet

Load the same tracking script as other sites. After `WorktualAnalytics.init({ websiteId, ... })`, call ecommerce helpers at the right UI moments (PDP, cart, wishlist, checkout, order confirmation).

## 3. Events to fire

| User action | SDK call | Event name |
|-------------|----------|------------|
| Product detail viewed | `productView({ productId, productName, productPrice, currency, ... })` | `product_view` |
| Add to cart | `addToCart({ productId, quantity, ... })` | `add_to_cart` |
| Remove from cart | `removeFromCart({ productId, ... })` | `remove_from_cart` |
| Add to wishlist | `addToWishlist({ productId, ... })` | `add_to_wishlist` |
| Remove from wishlist | `removeFromWishlist({ productId, ... })` | `remove_from_wishlist` |
| Checkout started | `beginCheckout({ ... })` | `begin_checkout` |
| Order completed | `purchase({ orderId, revenue, currency, products })` | `purchase` |
| Refund | `refund({ orderId, revenue, ... })` | `refund` |

`productId` (or `id` / `sku`) is required for all product-scoped methods.

## 4. Example

See [`docs/examples/worktual-ecommerce.js`](examples/worktual-ecommerce.js).

## 5. Data pipeline

1. SDK → ingest → `custom_events` / staging  
2. Materialized views → `fact_product_interactions`, `fact_conversion_events`  
3. Daily rollups → `agg_ecommerce_daily`; query view **`web_tracking.ecommerce`** for merged daily KPIs  
4. API → `GET /api/analytics/ecommerce/*`  
5. UI → **Product Analytics** page (`/product-analytics`)

## 6. QA checklist

- [ ] ClickHouse DDL applied (`python scripts/apply_clickhouse_ddl.py`, includes `13_ecommerce_daily.sql`)  
- [ ] If upgrading an older cluster, recreate `mv_fact_product` so wishlist events land in `fact_product_interactions` (see comment in `05_materialized_views_pipeline.sql`)  
- [ ] SDK built and copied to `web/public` / CDN  
- [ ] Trigger test events on QA storefront and confirm Product Analytics KPIs update  

## 7. API endpoints (authenticated)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/analytics/ecommerce/overview?period=month` | KPI summary |
| `GET /api/analytics/ecommerce/products?period=month&limit=50` | All products |
| `GET /api/analytics/ecommerce/trending?period=week&limit=10` | Trending products |
| `GET /api/analytics/ecommerce/engaged-visitors?period=month&limit=20` | Visitors engaging with products |

Periods: `today`, `week`, `month`, `overall`.
