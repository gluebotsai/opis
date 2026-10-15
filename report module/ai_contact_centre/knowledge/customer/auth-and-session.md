# Customer — auth and session

## Purpose

Customer portal login and session for org admins / portal users. Every product spoke that embeds “My Account session” or deep-links into setup starts here.

## Auth

| Endpoint | Auth |
|----------|------|
| Login | Public |
| `/api/v1/me/*` | Customer Bearer |

## Source map

| Layer | Path |
|-------|------|
| Client | [`src/lib/customerAuth.js`](../../src/lib/customerAuth.js), [`src/lib/organizations.js`](../../src/lib/organizations.js), [`src/lib/customerPortal.js`](../../src/lib/customerPortal.js) |
| Server | [`server/customerAuth.js`](../../server/customerAuth.js), customer routes in [`server/index.js`](../../server/index.js) |

## Endpoints

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| POST | `/api/v1/customer/login` | `loginCustomer` / `loginCustomerUser` | `{ email, password }` | token + user | Stores customer token |
| GET | `/api/v1/me/entitlements` | `getMyCustomerEntitlements` | — | org, subscriptions, user | See entitlements.md |
| PUT | `/api/v1/me/password` | `changeCustomerPassword` | password payload | success | |
| GET | `/api/v1/me/subscriptions/:id/usage` | `getCustomerSubscriptionUsage` | — | `{ usage }` | Portal usage meters |

Staff-side provisioning (not customer token):

| Method | Path | Client helper | Notes |
|--------|------|---------------|-------|
| POST | `/api/leads/:id/customer-portal-access` | `provisionCustomerPortalAccess` | Sales grants portal access |
| GET | `/api/leads/:id/customer-portal-users` | (leads helpers) | List portal users for lead |

## Dependencies / gates

Valid customer credentials; org must exist after conversion/payment.

## Reuse notes

- Product spokes should accept the **same customer JWT** or redirect to My Account login — do not invent a second customer identity store.
- After login, call entitlements before showing CRM/CCaaS/Lola modules.
