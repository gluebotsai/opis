# Campaign App push — onboarding handoff (Crusher / integration team)

**Audience:** Onboarding team (Crusher), solution engineers, and anyone who hands mobile-app push registration to a customer  
**Purpose:** When a company wants **Campaign App push** (FCM/APNs device tokens linked to Contacts), onboarding mints an org **integration secret**, confirms tenant setup, and emails the **company backend team** a copy-paste API pack.  
**Status:** Backend live on **rebuild-campaign-api** (commit `2b06d51` and later). Campaign **UI** for “Generate integration key” is optional; onboarding uses **internal API** only.

---

## 1. When to use this flow

| Situation | Use App push onboarding API |
|-----------|----------------------------|
| Customer’s **mobile app** should receive Campaign **App push** sends | Yes |
| Customer asks to “link app users to Campaign” / “register FCM tokens” | Yes |
| Customer only needs **email / SMS / WhatsApp** | No — different channels |
| Customer wants **Web push** (browser) | No — [Web push handoff](./CAMPAIGN_WEB_PUSH_ONBOARDING_HANDOFF.md); VAPID in My Accounts Channel Setup |
| Customer developers ask for **Campaign user login inside the app** | No — integrator path is **`X-Api-Key`**, not end-user JWT |

**Trigger (customer → onboarding):**

- “We need API details to register push tokens after our app login.”
- “Worktual Campaign App push integration for org *&lt;name&gt;*.”

**Outcome:**

- Company stores **`wk_ap_…`** in their secrets manager.
- Their **backend** calls **`POST /api/app-push/endpoints`** when the app obtains **`pushNotificationId`** (FCM/APNs).
- Tenant admin has **App Push active** in **My Accounts → Setup → Channel Setup** (FCM/APNs). Campaign Configuration no longer stores those keys.

---

## 2. Architecture (who does what)

```text
┌─────────────────┐     mint key      ┌──────────────────────────────┐
│ Onboarding      │ ────────────────► │ Campaign API (rebuild-campaign│
│ (Crusher)       │  x-internal-key   │ -api.worktual.com)           │
└────────┬────────┘                   └──────────────┬───────────────┘
         │ handoff email (wk_ap_…)                     │
         ▼                                             │ register token
┌─────────────────┐                                   │
│ Company backend │ ─── X-Api-Key + JSON ────────────►│
└────────┬────────┘                                   │
         │                                            ▼
┌─────────────────┐                          CDP contact + push_endpoints
│ Mobile app      │  pushNotificationId ──► company backend only
└─────────────────┘
```

| Role | Responsibility |
|------|----------------|
| **Onboarding** | Resolve **organizationId**, mint **integration key**, confirm App Push is **active** in My Accounts Channel Setup, send handoff email, optional smoke test |
| **Tenant admin** (customer) | Configure **Firebase / APNs** in **My Accounts → Setup → Channel Setup → App Push** and set status **active** |
| **Company backend** | Store **`X-Api-Key`**, call register API after app login / token refresh |
| **Mobile app** | Expose **`pushNotificationId`** (FCM/APNs) to company backend — **not** `deviceId`, socket id, or user id |
| **Campaign** | Loads FCM/APNs from My Accounts **in memory at send**; stores device tokens only |

---

## 3. Environments and URLs

| Surface | URL | Used for |
|---------|-----|----------|
| **Campaign API (integrators)** | `https://rebuild-campaign-api.worktual.com` | All **`/api/...`** calls below |
| **Campaign web app** | `https://rebuild-campaign.worktual.com` | Tenant admin login, Configuration UI, campaigns (not required for integrator register) |

Prefix all integration paths with **`/api`**.

**Validated on live (QA):**

- Mint with internal key → **201** + `wk_ap_…`
- Register with **`X-Api-Key`** + email → **200**, contact created under org (e.g. `CDP-campaign-org1001-…`)

---

## 4. Secrets onboarding must use (internal)

### 4.1 Internal service key (Crusher → Campaign only)

Onboarding **never** gives this key to the customer.

```http
x-internal-service-key: <INTERNAL_SERVICE_KEY>
```

| Item | Detail |
|------|--------|
| **Env var (Campaign backend)** | `INTERNAL_SERVICE_KEY` in server **`backend/.env`** (not in git) |
| **Production today** | Must match whatever is deployed on **nlp-webtracking** / rebuild API host. Ops confirmed example: `dev-internal-key` until rotated to a production secret. |
| **Wrong key** | **401** `"Valid x-internal-service-key required"` |
| **Unset on server** | Same **401** (fail closed) |

**Get the live value (server):**

```bash
grep INTERNAL_SERVICE_KEY backend/.env
docker compose exec backend sh -c 'echo $INTERNAL_SERVICE_KEY'
```

Align onboarding runbooks with **Campaign DevOps** before sharing keys in Slack/email.

### 4.2 Org integration key (customer-facing)

| Item | Detail |
|------|--------|
| **Format** | `wk_ap_` + random secret (e.g. `wk_ap_tRRl7KyLXjgQYo5jjL9QzHs68wLh8YAL`) |
| **Purpose** | Header **`X-Api-Key`** on **`POST /api/app-push/endpoints`** |
| **Not the same as** | Numeric **`organizationId`** (e.g. `1001`), Campaign user JWT, or `deviceId` |
| **Storage** | `campaign.organization_api_keys` (hash only; plain key shown **once** at mint) |
| **Rotation** | Mint again → previous key **stops working** immediately |

---

## 5. Onboarding procedure (step by step)

### Step A — Ticket intake

Collect from customer or Accounts:

| Field | Example | Notes |
|-------|---------|--------|
| Company / tenant name | Inspire | |
| **organizationId** | `1001` | Same id as Accounts / Campaign entitlement — used **only** when minting |
| Primary contact email | `it@customer.com` | For handoff |
| Platforms | Android / iOS / both | Drives APNs requirement |
| Who configures Firebase | Customer admin vs Worktual | |

### Step B — Confirm App Push is active in My Accounts

Tenant admin (or Worktual on their behalf) must complete **My Accounts → Setup → Channel Setup → App Push**:

1. Firebase **service account JSON** (same project as the mobile app).
2. **APNs** .p8 + Key ID / Team ID if iOS sends are required.
3. Channel **status = active**.

Without **active**, register may succeed but **campaign sends / test push** will fail. Campaign does **not** store FCM/APNs in Configuration.

**Optional API check** (Campaign admin JWT — not for customer):

```http
GET /api/configuration/push/app_push
Authorization: Bearer <admin_jwt>
```

`source` should be `my_accounts` and `status` `ready` when Accounts owns the org.

### Step C — Mint org integration key (server-to-server)

Use **one** of these endpoints (same result).

**Preferred (dedicated internal route):**

```http
POST https://rebuild-campaign-api.worktual.com/api/internal/org-api-keys
Content-Type: application/json
x-internal-service-key: <INTERNAL_SERVICE_KEY>

{
  "organizationId": "1001"
}
```

**Alternate (configuration internal alias):**

```http
POST https://rebuild-campaign-api.worktual.com/api/configuration/internal/org-app-push-api-key
Content-Type: application/json
x-internal-service-key: <INTERNAL_SERVICE_KEY>

{
  "organizationId": "1001"
}
```

**Success (201):**

```json
{
  "statusCode": 201,
  "message": "Copy this key now — it will not be shown again. Send it as X-Api-Key on POST /api/app-push/endpoints.",
  "id": "1",
  "purpose": "app_push",
  "api_key": "wk_ap_…………",
  "key_prefix": "wk_ap_abc…xyz"
}
```

**Actions:**

1. Copy **`api_key`** immediately into your secure ticket / password vault.
2. Do **not** paste it in public channels.
3. If lost → **rotate** (mint again) and send customer the new key.

**Errors:**

| HTTP | Meaning |
|------|---------|
| 401 | Wrong/missing internal key or backend not configured |
| 400 | Missing `organizationId` |
| 404 | Route not deployed — run backend deploy + `prisma migrate deploy` |

### Step D — Optional smoke test (before customer email)

Use a **fake** FCM string for connectivity only, or a real QA device token.

```bash
API=https://rebuild-campaign-api.worktual.com
KEY=wk_ap_…   # from Step C

curl -sS -X POST "$API/api/app-push/endpoints" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $KEY" \
  -d '{
    "endpoint": "REAL_OR_TEST_FCM_TOKEN",
    "platform": "android",
    "email": "qa@customer.com"
  }'
```

**Success (200):** `contact_created` true/false, `contact.id` as **`CDP-campaign-org…`**, `integration.register_path` echoed.

**Do not** use literal `"<FCM_TOKEN>"` in production handoff — that stores a useless placeholder.

### Step E — Email handoff to company (template)

**Subject:** Worktual Campaign — App push device registration API

**Body (customize):**

---

Hello,

Your Worktual Campaign **App push** integration is enabled for tenant **&lt;Company&gt;**.

**1. API base**

`https://rebuild-campaign-api.worktual.com`

**2. Authentication (server-side only)**

Store this secret in your backend secrets manager. **Do not** embed it in the mobile app or commit it to git.

```http
X-Api-Key: wk_ap_<YOUR_SECRET_FROM_ONBOARDING>
```

**3. Register device after app login**

When your app obtains the FCM/APNs token (your field **`pushNotificationId`**):

```http
POST /api/app-push/endpoints
Content-Type: application/json
X-Api-Key: wk_ap_<YOUR_SECRET>

{
  "endpoint": "<same value as pushNotificationId>",
  "platform": "android",
  "email": "user@yourcompany.com"
}
```

- **`platform`:** `"android"` or `"ios"`.
- **Contact:** provide **`email` and/or `phone`** (at least one), or optional **`contactId`** if you already store Campaign CDP ids.
- **`pushNotificationId`** may be sent **instead of** **`endpoint`** (alias supported).
- Call again whenever the token **refreshes**.
- **Do not** send `deviceId`, socket id, or internal user id as the token.

**4. Worktual-side configuration**

Firebase/APNs **sending** credentials are configured in **My Accounts → Setup → Channel Setup → App Push** (status **active**). Your register call only submits **device tokens** and **contact identity**.

**5. Campaign sends**

After registration, include contacts in an **App push** campaign audience and launch from Campaign (or your existing campaign workflow).

**Support:** Reply to this thread for key rotation or integration questions.

---

### Step F — Close ticket

- [ ] `organizationId` recorded in CRM/ticket  
- [ ] `key_prefix` recorded (not full secret)  
- [ ] Customer confirmed register in **staging/production**  
- [ ] App Push **active** in My Accounts Channel Setup confirmed  
- [ ] Link to this doc stored in team wiki  

---

## 6. What the company must **not** do

| Mistake | Why |
|---------|-----|
| Use **`organizationId`** (`1001`) as **`X-Api-Key`** | Key is **`wk_ap_…`**, minted per org |
| Put **Campaign JWT** in the mobile app for register | Integrator auth is **`X-Api-Key`** only |
| Send **`deviceId`** instead of FCM/APNs token | Sends will fail; use **`pushNotificationId`** |
| Upload Firebase JSON via register API | Provider creds are **My Accounts Channel Setup** only |
| Share **`x-internal-service-key`** with customer | **Onboarding / Worktual internal only** |

---

## 7. API reference (integrator)

### 7.1 Register / update device

```http
POST /api/app-push/endpoints
X-Api-Key: wk_ap_…
Content-Type: application/json
```

| Field | Required | Notes |
|-------|----------|--------|
| `endpoint` or `pushNotificationId` or `token` | Yes | FCM/APNs device token |
| `platform` | Recommended | `android` \| `ios` |
| `email` | If no `contactId` | At least one of email / phone |
| `phone` | If no `contactId` | E.164 with country code |
| `contactId` | Optional | Existing CDP id |
| `firstName`, `lastName` | Optional | Used when creating contact (defaults App / User) |

**Alternative auth (QA only):** `Authorization: Bearer <Campaign user JWT>` — for manual tests in Configuration UI, **not** for customer production apps.

### 7.2 Deactivate device

```http
DELETE /api/app-push/endpoints/:id
X-Api-Key: wk_ap_…
```

### 7.3 List endpoints (debug)

```http
GET /api/app-push/endpoints
X-Api-Key: wk_ap_…
```

---

## 8. Onboarding-only APIs (never customer-facing)

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/internal/org-api-keys` | `x-internal-service-key` |
| POST | `/api/configuration/internal/org-app-push-api-key` | `x-internal-service-key` |

**Body:** `{ "organizationId": "<tenant id string>" }`

---

## 9. Tenant admin alternative (no internal key)

If a **Campaign administrator** for the tenant logs into **`https://rebuild-campaign.worktual.com`**:

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/configuration/integration/app-push-api-key` | Admin JWT — status + **prefix only** |
| POST | `/api/configuration/integration/app-push-api-key` | Admin JWT — mint/rotate, **plain key once** |

Mints for **logged-in org only**, not arbitrary `organizationId` in body.

*(UI button on Configuration → App push may ship in a later frontend deploy; API works today.)*

---

## 10. Key rotation

1. Mint new key (Step C) for same `organizationId`.  
2. Send customer **new** `wk_ap_…`.  
3. Customer updates **`X-Api-Key`** on their backend.  
4. Old key rejects with **401**.

Document rotation in ticket; never email old and new keys in the same public thread.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| 401 on mint | Wrong **`INTERNAL_SERVICE_KEY`** | Match server `backend/.env`; recreate backend container |
| 401 on register | Wrong/expired **`wk_ap_…`** | Re-mint; verify header name **`X-Api-Key`** |
| 400 register | No email/phone and no contactId | Add identity fields |
| 404 on mint routes | Old backend | Deploy backend ≥ `2b06d51`, run **`prisma migrate deploy`** |
| Push never arrives | App Push not **active** in My Accounts, or fake token | Activate Channel Setup; register a real FCM/APNs token. Campaign no longer pastes Firebase in Configuration when Accounts owns the org. |
| Audience shows no App push ID | Old backend list bug | Deploy backend with CDP join fix (same release) |

---

## 12. Deployment notes (DevOps)

Backend-only release is sufficient for integrators.

```bash
git pull origin main
docker compose run --rm backend npx prisma migrate deploy
docker compose build backend && docker compose up -d backend
```

Migration: **`20260921120000_organization_api_keys`** → table **`campaign.organization_api_keys`**.

Frontend deploy **not required** for customer **`X-Api-Key`** register path.

---

## 13. Related docs

| Doc | Topic |
|-----|--------|
| [CAMPAIGN_PUSH_ACCOUNTS_INTEGRATION.md](./CAMPAIGN_PUSH_ACCOUNTS_INTEGRATION.md) | Fetch FCM/APNs/VAPID from My Accounts at send (do not persist) |
| [CAMPAIGN_WEB_PUSH_ONBOARDING_HANDOFF.md](./CAMPAIGN_WEB_PUSH_ONBOARDING_HANDOFF.md) | Browser SDK, snippet subscribe, same-origin service worker |
| [CAMPAIGN_ONBOARDING_DASHBOARD_HANDOFF.md](./CAMPAIGN_ONBOARDING_DASHBOARD_HANDOFF.md) | Post–set-password dashboard deep link (same internal key pattern) |
| [deploy/README.md](../deploy/README.md) | Docker deploy and migrate |
| Configuration → App push (in product) | Integration key, manual test register (admin JWT). Provider keys: My Accounts Channel Setup |

---

## 14. Glossary

| Term | Meaning |
|------|---------|
| **pushNotificationId** | Customer app field name for FCM/APNs token |
| **endpoint** | JSON field name on Campaign register API (same value) |
| **organizationId** | Tenant id for **mint** request only (e.g. `1001`) |
| **wk_ap_…** | Org **integration API key** for **`X-Api-Key`** |
| **CDP id** | Contact id format `CDP-campaign-org{id}-{numeric}` |
| **active** | My Accounts App Push channel status — required before Campaign send |

---

*Last updated: 2026-09-21 — App push org API key + My Accounts credentials at send.*
