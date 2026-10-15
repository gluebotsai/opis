# Campaign onboarding — dashboard deep-link handoff

**Audience:** Accounts / onboarding team  
**Purpose:** After a user sets their password, send them straight to the Campaign **dashboard** without asking them to log in again.

Password setup stays in **Accounts**. Campaign only issues a **one-time browser link** once the user is active and has a password hash.

---

## Flow

1. Onboarding creates user and sends invite email (Accounts).
2. User completes **set password** (Accounts).
3. Onboarding backend calls Campaign (internal key).
4. Campaign returns a one-time URL.
5. Redirect the user’s browser to that URL → Campaign stores JWT → **`/dashboard`**.

**Do not** send the user’s password to Campaign. Only **email** or **userId** plus the internal service key.

---

## 1. Mint dashboard link (server-to-server)

```http
POST {API_BASE}/auth/onboarding-dashboard-link
Content-Type: application/json
x-internal-service-key: <INTERNAL_SERVICE_KEY>
```

**Body** (one of):

```json
{ "email": "user@company.com" }
```

```json
{ "userId": "1234567890123456789" }
```

**Success (200):**

```json
{
  "statusCode": 200,
  "message": "Onboarding dashboard link created",
  "url": "https://rebuild-campaign.worktual.com/auth/onboarding?code=…",
  "expiresIn": 900,
  "user": {
    "id": "…",
    "email": "user@company.com",
    "organizationId": "…"
  }
}
```

Redirect the browser to **`url`**. Link expires in **15 minutes** (`expiresIn` seconds). Single use.

**Errors:**

| Code | Meaning |
|------|---------|
| 401 | Missing/wrong `x-internal-service-key` |
| 404 | User not found or inactive |
| 409 | Password not set yet — wait until Accounts set-password completes |

---

## 2. Browser exchange (Campaign FE — automatic)

When the user opens `url`, the SPA calls:

```http
POST {API_BASE}/auth/onboarding-exchange
Content-Type: application/json

{ "code": "<from query string>" }
```

Response: `{ token, user, redirectTo: "/dashboard" }`. Token is stored like a normal login.

---

## 3. Configuration

| Variable | Where | Notes |
|----------|--------|--------|
| `INTERNAL_SERVICE_KEY` | Campaign **backend** `.env` | Same key onboarding sends in header |
| `NEXT_PUBLIC_APP_URL` / `PUBLIC_APP_URL` | Backend + FE build | Base for `url` (e.g. `https://rebuild-campaign.worktual.com`) |

**Live example:**

- API: `https://rebuild-campaign.worktual.com/api/auth/onboarding-dashboard-link`
- Dashboard landing: `https://rebuild-campaign.worktual.com/dashboard`

---

## 4. curl test (after deploy)

```bash
curl -sS -X POST "https://rebuild-campaign.worktual.com/api/auth/onboarding-dashboard-link" \
  -H "Content-Type: application/json" \
  -H "x-internal-service-key: YOUR_KEY" \
  -d '{"email":"user@company.com"}'
```

Open the returned `url` in a browser — should land on dashboard without login.

---

## 5. Fallback

If deep-link is not used, the user can always sign in at `/login` with email + password after set-password.
