# Web Tracking — onboarding dashboard handoff

**Audience:** My Accounts / Onboarding / Setup People  
**Product id:** `web-tracking`  
**Purpose:** After set-password in Accounts, redirect the user into Web Tracking without logging in again.

---

## Summary

| Role | Action |
|------|--------|
| **Accounts** | Save password → call **mint** API → browser redirect to `redirect_url` |
| **Web Tracking** | Validate user (read-only Postgres) → store one-time code → exchange → JWT → dashboard `/` |

Password and all **`setup_users` writes stay in Accounts.** Web Tracking only **SELECT**s eligibility and issues a session.

---

## What Web Tracking has implemented

| Item | Value |
|------|--------|
| Mint (server-to-server) | `POST https://qatrackingapi.worktual.com/api/auth/onboarding/redirect` |
| Exchange | `POST https://qatrackingapi.worktual.com/api/auth/onboarding/exchange` |
| User callback (browser) | `https://qatracking.worktual.com/auth/callback?code=<one-time>` |
| Dashboard home | `https://qatracking.worktual.com/` |
| Fallback login | `https://qatracking.worktual.com/login` |
| Mint authentication | **`x-internal-service-key`** only (same as Campaign) |
| Code TTL | 600 s default (`ONBOARDING_CODE_TTL_SECONDS`) |
| Code storage | **Redis** if `REDIS_URL` is set; else **in-memory** in the API process (single-node / QA only) |
| Postgres | **Read-only** (`POSTGRES_READ_ONLY=true`) — eligibility queries only, no user/password updates |

**Repo reference**

| Area | Path |
|------|------|
| Routes | `api-node/src/routes/auth.ts` |
| Eligibility | `api-node/src/utils/onboardingAuth.ts` |
| One-time codes | `api-node/src/services/onboardingCodes.ts` |
| Callback page | `web/src/pages/AuthCallback.tsx` |
| My Accounts reads | `api-node/src/repositories/postgres/myAccountsAuth.ts` |

---

## What Accounts / Onboarding must implement

### Flow

1. Setup user completes **set password** in Accounts.
2. Accounts **backend** calls Web Tracking **mint** (never expose secret or mint from browser).
3. On **200**, redirect browser to **`redirect_url`** from JSON.
4. Web Tracking FE exchanges `code` automatically → user lands on **`/`**.
5. On mint failure: do **not** roll back password; send user to **`/login`**.

### Mint request

```http
POST https://qatrackingapi.worktual.com/api/auth/onboarding/redirect
Content-Type: application/json
x-internal-service-key: <INTERNAL_SERVICE_KEY>
```

**Body:**

```json
{
  "user_id": 12345,
  "email": "user@company.com",
  "organization_id": 1003,
  "website_id": 1002
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `user_id` | Yes | `accounts.setup_users.id` |
| `email` | Yes | Work email; must match user |
| `organization_id` | Yes | Must match user’s org |
| `website_id` | No | Web Tracking slot; omit = first site for org |

### Mint response (200)

```json
{
  "redirect_url": "https://qatracking.worktual.com/auth/callback?code=…",
  "code": "…",
  "expires_in_seconds": 600,
  "website_id": 1002,
  "websites": [
    { "website_id": 1002, "website_url": "example.com", "site_type": "ecommerce" }
  ]
}
```

Redirect the browser to **`redirect_url`** only. Do not hardcode `code`.

### Mint errors

| HTTP | Meaning |
|------|---------|
| 401 | Missing/wrong `x-internal-service-key` |
| 403 | Not eligible (access, websites, id/email/org mismatch) |
| 503 | `INTERNAL_SERVICE_KEY` not set on API |
| 501 | Not My Accounts auth mode |

### Eligibility (same as Web Tracking login)

- Password set (`password_hash`, `password_set_at`)
- User active; invite not pending / expired / revoked
- `setup_user_product_access.product_id = web-tracking`
- Org has ≥1 website in entitlement (`visitorAllowanceBySlot`)

### Suggested Accounts env

```bash
WEB_TRACKING_API_BASE=https://qatrackingapi.worktual.com
# Same value as Campaign INTERNAL_SERVICE_KEY or product-specific override
WEB_TRACKING_INTERNAL_SERVICE_KEY=<shared with Web Tracking — secure channel only>
```

---

## Browser exchange (Accounts does not call)

When user opens `redirect_url`:

```http
POST https://qatrackingapi.worktual.com/api/auth/onboarding/exchange
Content-Type: application/json

{ "code": "<from query string>" }
```

**Response:** same as `POST /api/auth/login` (`token`, `admin_name`, `email`, `organization_id`, `website_id`, `website_url`, `site_type`, `features`, `websites`).

| HTTP | Meaning |
|------|---------|
| 410 | Code expired or already used |

---

## PostgreSQL (read-only)

Web Tracking API uses Accounts Postgres **SELECT only** for onboarding.

| Step | Postgres | Notes |
|------|----------|--------|
| Mint | SELECT | User, product access, org websites |
| Exchange | SELECT | Re-validate before JWT |
| One-time `code` | **Not in Postgres** | Redis or in-memory |

Prisma blocks INSERT/UPDATE/DELETE when `POSTGRES_READ_ONLY=true`. Do not add onboarding audit writes to Accounts DB from Web Tracking.

---

## One-time code storage (no Redis)

If **`REDIS_URL` is not configured**:

- Codes live in an **in-memory `Map`** inside one API process.
- **Works:** single-server QA, curl + browser on same instance.
- **Limitations:** lost on restart; **not shared** across multiple API nodes behind a load balancer.

**Production / multi-instance:** configure `REDIS_URL` on Web Tracking API when available.

---

## vs generic spoke handoff (Campaign-style)

| Generic doc | Web Tracking |
|-------------|--------------|
| `POST …/auth/onboarding-dashboard-link` | `POST …/api/auth/onboarding/redirect` |
| `x-internal-service-key` | **Same** |
| Body `{ "email" }` | `user_id`, `email`, `organization_id`, optional `website_id` |
| Response `url` | **`redirect_url`** |
| `/auth/onboarding?code=` | **`/auth/callback?code=`** |
| Exchange `…/onboarding-exchange` | `…/api/auth/onboarding/exchange` |

---

## Dashboard variant (not separate B2B/B2C URLs)

- **One** mint + callback flow for all customers.
- UI differences come from **`site_type` → `features`** on the active website (same as normal login).
- Optional **`website_id`** in mint picks the active site when an org has multiple slots.

---

## Web Tracking API configuration

| Variable | Purpose |
|----------|---------|
| `INTERNAL_SERVICE_KEY` | Mint auth (share with Accounts; same as Campaign) |
| `DASHBOARD_PUBLIC_URL` | e.g. `https://qatracking.worktual.com` |
| `ONBOARDING_CODE_TTL_SECONDS` | Default `600` |
| `AUTH_SOURCE` | `my_accounts` required for onboarding APIs |
| `POSTGRES_READ_ONLY` | Default `true` |
| `REDIS_URL` | Optional; recommended for multi-instance |

---

## Smoke test

```bash
curl -sS -X POST "https://qatrackingapi.worktual.com/api/auth/onboarding/redirect" \
  -H "Content-Type: application/json" \
  -H "x-internal-service-key: YOUR_INTERNAL_SERVICE_KEY" \
  -d '{
    "user_id": 12345,
    "email": "user@company.com",
    "organization_id": 1003,
    "website_id": 1002
  }'
```

Open **`redirect_url`** in a browser → dashboard without login form.

---

## Checklist

**Web Tracking**

- [ ] `INTERNAL_SERVICE_KEY` set on QA/prod API
- [ ] `DASHBOARD_PUBLIC_URL` matches dashboard host
- [ ] `/auth/callback` deployed on dashboard
- [ ] (Optional) `REDIS_URL` for multi-node

**Accounts**

- [ ] Mint after set-password only
- [ ] Redirect to `redirect_url`
- [ ] Fallback to `https://qatracking.worktual.com/login` on mint failure
- [ ] Test user with `web-tracking` + org websites
- [ ] Shared secret received via secure channel

---

## Ready line for Accounts

> Web Tracking onboarding redirect is implemented. Wire **POST** `https://qatrackingapi.worktual.com/api/auth/onboarding/redirect` with product id **`web-tracking`**, then redirect the browser to **`redirect_url`**.

---

## Changelog

| Date | Note |
|------|------|
| 2026-09-14 | Initial handoff: mint/exchange, read-only Postgres, Redis or in-memory codes. |
