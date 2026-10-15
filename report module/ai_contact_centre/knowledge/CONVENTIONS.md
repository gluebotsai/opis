# API conventions

Shared rules for every My Account HTTP API. Product spokes (CRM, CCaaS, Campaign, Ticketing, CDP, CVM, Lola) should follow these when reusing contracts.

## Base URLs

| Environment | API | Typical UI |
|-------------|-----|------------|
| Local | `http://localhost:3002` (Express) | Vite `http://localhost:5173` proxies `/api` → API |
| Code | Always call **relative** paths like `/api/v1/me/...` from the browser | |

Dev start: `pnpm run dev:all` (API + Vite).

## Client helper: `fetchJson`

**File:** [`src/lib/http.js`](../src/lib/http.js)

- Attaches `Authorization: Bearer <token>` for `/api/*` (except public paths).
- Token preference: staff `getAuthToken()` **or** customer `getCustomerToken()`.
- JSON body: sets `Content-Type: application/json`.
- `FormData` body: **does not** set Content-Type (browser sets multipart boundary).
- Errors: throws `Error` with message from `{ error }` or `{ message }`.
- `204` → returns `null`.

Public paths (no Bearer required):

- `/api/auth/login`, `/api/auth/sign-in`
- `/api/v1/customer/login`
- `/api/health`
- `/api/payments/config`
- `/api/pricing-catalog`

## Auth models

| Kind | Storage (client) | Server gate |
|------|------------------|-------------|
| Customer | `customerAuth` token | `withCustomerAuth` — org-scoped customer user |
| Staff | `auth` token | `requireAuth` |
| Admin | staff + role | `requireAdminAuth` |
| Finance | staff + role | `requireFinanceAuth` |
| Mail | mail auth | `requireMailAuth` |

Setup mutations usually also require **organization admin** customer role (enforced in setup services).

## Typical response shapes

| Pattern | Example |
|---------|---------|
| Single entity | `{ config: {...} }`, `{ queue: {...} }`, `{ profile: {...} }` |
| Lists | `{ channels: [...] }`, `{ queues: [...] }`, `{ documents: [...] }` |
| Entitlements | `{ organization, subscriptions, user, ... }` |
| Empty success | HTTP `204` no body |
| Failure | `{ error: "human message" }` + 4xx/5xx |

Field names in JSON are **camelCase** on the wire for customer/setup APIs (server maps from DB snake_case).

## Setup API base

All setup client helpers use:

```text
BASE = /api/v1/me/setup
```

Implemented in [`src/lib/setup/setupApi.js`](../src/lib/setup/setupApi.js).

## Product gates (important for spokes)

| Capability | Required purchased product id(s) |
|------------|----------------------------------|
| Web Chat channel | `contact-center` |
| CCaaS queues | `contact-center` |
| Email channel | `contact-center` and/or `campaign` (allowlist) |

Catalog ids live in [`src/lib/productCatalog.js`](../src/lib/productCatalog.js).

## Per-file documentation template

Copy this into new knowledge pages:

```markdown
# Title

## Purpose
Why a product spoke would call this.

## Auth
Customer Bearer / staff / admin / …

## Source map
| Layer | Path |
|-------|------|
| Client | `src/lib/...` |
| Server | `server/...` |
| Repo | `server/repositories/raw/...` |

## Endpoints
| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|

## Dependencies / gates
…

## Reuse notes
What CRM/CCaaS/Lola should call vs reimplement.
```

## OAuth callback hosts (email / mail)

Non-`/api` browser redirects used by providers:

- `/auth/google/callback`
- `/auth/microsoft/callback`
- `/auth/yahoo/callback`

Also mirrored under `/api/mail/oauth/.../callback` for internal mail.
