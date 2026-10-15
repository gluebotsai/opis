# Customer — entitlements and subscriptions

## Purpose

Answer “what did this org buy?” — product ids, plans, invoices, and usage. CRM, CCaaS, Campaign, Ticketing, CDP, CVM, and Lola should gate features off these product ids (`contact-center`, `campaign`, `crm`, …).

## Auth

| Caller | Auth |
|--------|------|
| Customer portal | Customer Bearer on `/api/v1/me/...` |
| Internal sales | Staff Bearer on `/api/v1/organizations/...` and `/api/v1/subscriptions/...` |

## Source map

| Layer | Path |
|-------|------|
| Client | [`src/lib/organizations.js`](../../src/lib/organizations.js), [`src/lib/customerPortal.js`](../../src/lib/customerPortal.js), [`src/lib/productCatalog.js`](../../src/lib/productCatalog.js) |
| Server | subscriptions / entitlements modules wired from [`server/index.js`](../../server/index.js) |

## Endpoints

### Customer

| Method | Path | Client helper | Response | Notes |
|--------|------|---------------|----------|-------|
| GET | `/api/v1/me/entitlements` | `getMyCustomerEntitlements` | organization, subscriptions, user | Primary spoke gate |
| GET | `/api/v1/me/subscriptions/:id/usage` | `getCustomerSubscriptionUsage` | `{ usage }` | |

### Internal (sales / ops)

| Method | Path | Client helper | Response | Notes |
|--------|------|---------------|----------|-------|
| GET | `/api/v1/organizations/:id` | `getOrganizationById` | `{ organization }` | |
| GET | `/api/v1/organizations/:id/subscriptions` | `getOrganizationSubscriptions` | `{ subscriptions }` | |
| GET | `/api/v1/subscriptions/:id/entitlements` | `getSubscriptionEntitlements` | entitlements | |
| GET | `/api/v1/subscriptions/:id/invoices` | (organizations / invoice helpers) | invoices | |
| GET | `/api/v1/subscriptions/:id/usage` | `getSubscriptionUsage` | usage | |
| POST | `/api/v1/subscriptions/:id/usage` | `reportSubscriptionUsage` | `{ metricKey, consumed }` | Report consumption |

### Catalog (public)

| Method | Path | Client | Notes |
|--------|------|--------|-------|
| GET | `/api/pricing-catalog` | pricing catalog helpers | Public product/plan catalog |
| PUT | `/api/admin/pricing-catalog` | admin | Admin updates catalog |

## Product id reference

From `PRODUCT_CATALOG` / subscriptions:

| id | Product |
|----|---------|
| `contact-center` | CCaaS |
| `crm` | CRM |
| `cdp` | CDP |
| `campaign` | Campaign |
| `value-management` | CVM |
| `ticketing` | Ticketing |

## Reuse notes

- Gate UI with `getPurchasedProductCatalog(activeProducts)` or equivalent from entitlements.
- Web Chat / queues APIs **server-enforce** `contact-center`; still check client-side for UX.
