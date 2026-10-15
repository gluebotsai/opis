# Web Tracking — onboarding team integration

**Product id (Setup People):** `web-tracking`  
**When to call:** Only **after** the user has successfully set their password in Accounts.

Same auth pattern as **Campaign**: `x-internal-service-key` + shared secret.

---

## Flow

1. User completes set-password in Accounts.
2. Accounts **backend** calls Web Tracking **mint** API.
3. Redirect the browser to **`redirect_url`** from the response.
4. User lands on the Web Tracking dashboard (no login form).
5. If mint fails → send user to login fallback (do **not** undo password setup).

---

## Mint API

```http
POST https://qatrackingapi.worktual.com/api/auth/onboarding/redirect
Content-Type: application/json
x-internal-service-key: <INTERNAL_SERVICE_KEY>
```

**Request body:**

```json
{
  "user_id": 12345,
  "email": "user@company.com",
  "organization_id": 1003,
  "website_id": 1002
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `user_id` | Yes | `accounts.setup_users.id` |
| `email` | Yes | Work email; must match user |
| `organization_id` | Yes | Must match user’s organisation |
| `website_id` | No | Web Tracking site slot; omit to use default site |

**Success (200):**

```json
{
  "redirect_url": "https://qatracking.worktual.com/auth/callback?code=…",
  "expires_in_seconds": 600
}
```

**Action:** HTTP redirect (or equivalent) to **`redirect_url`**.  
The `code` is **single-use** and expires in about **10 minutes**. Do not construct this URL yourself.

---

## Errors

| HTTP | Meaning | Accounts action |
|------|---------|-----------------|
| 401 | Missing/wrong `x-internal-service-key` | Fix secret / header; soft-fail to login |
| 403 | User not eligible | Soft-fail to login |
| 503 | Web Tracking not configured | Contact Web Tracking team |
| 501 | Wrong auth mode | Contact Web Tracking team |

**Fallback login:** `https://qatracking.worktual.com/login`

---

## User eligibility

Before mint will succeed, the user must have:

- **Web Tracking** assigned in Setup People (`web-tracking`)
- Password set in Accounts (`password_set_at`)
- Active account (invite not pending / expired / revoked)
- At least one **Web Tracking website URL** configured for the organisation

---

## Secret

| Item | Detail |
|------|--------|
| **Header** | `x-internal-service-key` only (same as Campaign) |
| **Value** | Provided by Web Tracking team via **secure channel** (not email body, not frontend) |
| **Accounts env (suggested)** | `WEB_TRACKING_API_BASE=https://qatrackingapi.worktual.com` and product-specific key or shared `INTERNAL_SERVICE_KEY` |

Web Tracking API env: **`INTERNAL_SERVICE_KEY`** (must match what Accounts sends).

---

## Smoke test

```bash
curl -sS -X POST "https://qatrackingapi.worktual.com/api/auth/onboarding/redirect" \
  -H "Content-Type: application/json" \
  -H "x-internal-service-key: YOUR_INTERNAL_SERVICE_KEY" \
  -d '{
    "user_id": 12345,
    "email": "user@company.com",
    "organization_id": 1003
  }'
```

Open **`redirect_url`** in a browser → should reach the dashboard without the login page.

---

## vs Campaign (same auth, different paths)

| | Campaign | Web Tracking |
|---|----------|--------------|
| Mint path | `/api/auth/onboarding-dashboard-link` | `/api/auth/onboarding/redirect` |
| Auth header | `x-internal-service-key` | **Same** |
| URL field in response | `url` | **`redirect_url`** |
| Callback route | `/auth/onboarding?code=` | `/auth/callback?code=` |
| Dashboard home | `/dashboard` | `/` |

---

## More detail

Engineering handoff (Postgres read-only, codes, env): [`WEB_TRACKING_ONBOARDING_DASHBOARD_HANDOFF.md`](./WEB_TRACKING_ONBOARDING_DASHBOARD_HANDOFF.md)
