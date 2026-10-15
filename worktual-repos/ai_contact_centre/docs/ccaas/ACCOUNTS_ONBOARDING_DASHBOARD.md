# Contact Center — Accounts onboarding dashboard deep-link

**Audience:** My Accounts / Setup People  
**Spoke:** Contact Center (`product_id`: `contact-center`)  
**Status:** Ready to wire mint + browser redirect (same pattern as Campaign)

Password setup stays in **Accounts**. After set-password, Accounts mints a one-time URL from Contact Center and redirects the browser. Contact Center never receives the user’s password.

---

## What to configure in Accounts

| Item | Value |
|------|--------|
| **API base** | `https://rebuild-ccaas-api.worktual.com/cc-core-api/v1` |
| **Mint path** | `/auth/onboarding-dashboard-link` |
| **Full mint URL** | `https://rebuild-ccaas-api.worktual.com/cc-core-api/v1/auth/onboarding-dashboard-link` |
| **Landing after exchange** | Admin: `/admin/dashboard` · Agent: `/agent/workspace` |
| **FE exchange route** | `https://rebuild-ccaas.worktual.com/auth/onboarding?code=…` |
| **Internal service key** | Same `INTERNAL_SERVICE_KEY` already shared with Contact Center (`x-internal-service-key`) |
| **Setup product id** | `contact-center` |

Suggested Accounts env:

```bash
CONTACT_CENTER_API_BASE=https://rebuild-ccaas-api.worktual.com/cc-core-api/v1
# Optional override; else INTERNAL_SERVICE_KEY
# CONTACT_CENTER_INTERNAL_SERVICE_KEY=
```

Local / docker-internal mint (no Nginx):

```bash
# API base
http://localhost:3000/api/v1
# also mounted at
http://localhost:3000/cc-core-api/v1
```

---

## Mint dashboard link (server-to-server)

Call **after** password is saved (never before).

```http
POST {API_BASE}/auth/onboarding-dashboard-link
Content-Type: application/json
x-internal-service-key: <INTERNAL_SERVICE_KEY>
```

**Body** (email preferred):

```json
{ "email": "user@company.com" }
```

Optional:

```json
{ "userId": "1234567890123456789" }
```

**Success (200):**

```json
{
  "statusCode": 200,
  "message": "Onboarding dashboard link created",
  "url": "https://rebuild-ccaas.worktual.com/auth/onboarding?code=…",
  "expiresIn": 900,
  "user": {
    "id": "…",
    "email": "user@company.com",
    "organizationId": "…"
  }
}
```

- Redirect the browser to **`url`**.
- Link expires in **15 minutes** (`expiresIn`: 900).
- Link is **single use**. A new mint invalidates any unused prior code for that user.

**Errors (do not undo password setup; show “Continue to sign in”):**

| Code | Meaning |
|------|---------|
| 401 | Missing/wrong `x-internal-service-key` |
| 404 | User not found, inactive, or no `contact-center` product grant |
| 409 | Password not set yet / user not ready |

---

## Browser exchange (Contact Center FE)

Accounts does **not** call this. The SPA at `url` does:

```http
POST {API_BASE}/auth/onboarding-exchange
Content-Type: application/json

{ "code": "<from query string>" }
```

**Response:**

```json
{
  "token": "…",
  "user": { },
  "redirectTo": "/admin/dashboard"
}
```

`redirectTo` is `/admin/dashboard` for admin/manager/supervisor and `/agent/workspace` for agents.

---

## curl smoke test (QA)

```bash
curl -sS -X POST "https://rebuild-ccaas-api.worktual.com/cc-core-api/v1/auth/onboarding-dashboard-link" \
  -H "Content-Type: application/json" \
  -H "x-internal-service-key: YOUR_KEY" \
  -d '{"email":"user@company.com"}'
```

Open the returned `url` in a browser — should land on the Contact Center home for that role without a login form.

Local:

```bash
curl -sS -X POST "http://localhost:3000/api/v1/auth/onboarding-dashboard-link" \
  -H "Content-Type: application/json" \
  -H "x-internal-service-key: YOUR_KEY" \
  -d '{"email":"user@company.com"}'
```

---

## Fallback

If mint fails or the link expires, the user signs in at `https://rebuild-ccaas.worktual.com/login` with email + password.

---

## Checklist

- [x] Mint endpoint with the paths/headers above
- [x] Exchange endpoint + FE route `/auth/onboarding?code=`
- [x] Shared `INTERNAL_SERVICE_KEY` (same as existing Contact Center internal calls)
- [x] Product id `contact-center`
- [ ] Accounts env `CONTACT_CENTER_API_BASE` + redirect after set-password
- [ ] Test user exists in Setup People with Contact Center grant **and** a password

**Ready — use API base `https://rebuild-ccaas-api.worktual.com/cc-core-api/v1`, product id `contact-center`.**
