# CRM → Campaign API handoff

> **Overview (both teams):** [CRM_CAMPAIGN_INTEGRATION.md](CRM_CAMPAIGN_INTEGRATION.md) — how CRM and Campaign connect (iframe, postMessage, JWT, agents).

Integration between **Worktual CRM** (`192.168.13.126`) and **Campaign API** (`192.168.11.31:3001`).

## Summary

CRM users are the same Accounts users (`accounts.setup_users`). CRM cannot replay passwords (DB has hashes only). CRM calls Campaign using the **logged-in user's CRM access JWT** — no password exchange, no token swap endpoint.

**Auth path:** **A** — CRM sends `Authorization: Bearer <CRM access JWT>` directly to campaign endpoints.

## What CRM must provide (Campaign team needs this)

| Item | Env var on Campaign | Notes |
|------|---------------------|-------|
| JWT signing secret | `CRM_JWT_ACCESS_SECRET` | Same value as CRM's `JWT_ACCESS_SECRET`. **Not** Campaign's `JWT_SECRET`. |
| Issuer (`iss` claim) | `CRM_JWT_ISSUER` | Set to `worktual-crm` |
| User id claim name | `CRM_JWT_USER_ID_CLAIM` | Set to `sub` — must match Accounts `setup_users.id` |
| Algorithm | `CRM_JWT_ALGORITHM` | Default: `HS256` |

Confirm with CRM team:
- Token lifetime / refresh behaviour on CRM side
- Test user email for org `1000` with active Campaign product

## Campaign backend configuration

Add to Campaign backend `.env` on `192.168.11.31`:

```bash
CRM_JWT_ACCESS_SECRET="<JWT_ACCESS_SECRET from CRM team>"
CRM_JWT_ISSUER="worktual-crm"
CRM_JWT_USER_ID_CLAIM="sub"
CRM_JWT_ALGORITHM="HS256"
```

Restart Campaign API after setting `CRM_JWT_ACCESS_SECRET`.

## How auth works

1. CRM sends `Authorization: Bearer <CRM access JWT>` to `/api/campaigns/*`
2. Campaign tries **Campaign SPA JWT** first (`JWT_SECRET`) — unchanged for Vite UI
3. If that fails, Campaign verifies **CRM access JWT** with `CRM_JWT_ACCESS_SECRET`
4. Extract user id from JWT claim → load `accounts.setup_users` → **403** if not found or inactive
5. Require `accounts.setup_user_product_access` with `product_id = crm` (any CRM role) → **403** if missing
6. `tenantId` = user's `organization_id` (never from request body)
7. Check active Campaign org entitlement in `campaign.organization_products` → **403** if not entitled (no auto-provision for CRM)
8. Invalid/expired CRM token → **401**

**Scope:** CRM JWT works on **all authenticated SPA API routes** (`/api/*` except public endpoints). Campaign SPA JWT is always tried first.

## Backend automation (monitor/agent — no user login)

CRM’s monitor/agent calls Personalised CRM with **one shared integration key + `organization_id`**. This is separate from embed/user JWT.

| Env var | Value | CRM usage |
|---------|-------|-----------|
| **`CRM_INTEGRATION_KEY`** | `crm-int-9Kp4Wm2Rx7Nv8sL3tYc5HdaB6uQ1eZ` | Header `X-Crm-Integration-Key` (or `Authorization: Bearer` of this string) |
| `CRM_JWT_ACCESS_SECRET` | `7noyifG2Pj61_cPAv04F88xDSq3jlOXF6kROV0c-AwgfFan6W9r44o4WZUQ7J_OJ` | Server-side JWT signing only — **not** this API’s Bearer |

```
POST /api/campaigns/personalised-crm/automation
X-Crm-Integration-Key: crm-int-9Kp4Wm2Rx7Nv8sL3tYc5HdaB6uQ1eZ
```

Body must include `organization_id`, `channels`, and audience. `acting_user_id` is optional (first active user in the org if omitted). Full contract: [PERSONALISED_CRM_API.md](PERSONALISED_CRM_API.md).

Restart Campaign API after setting `CRM_INTEGRATION_KEY`.

## Campaign Portal embed (iframe)

CRM Marketing embeds the Campaign UI inside an iframe. Path A API auth stays; this adds UI embedding + token handoff.

### Permanent embed behaviour (Campaign QA)

| # | Behaviour |
|---|-----------|
| 1 | **Token refresh** — lifetime `message` listener; every `worktual:campaign-auth` overwrites sessionStorage; 401 → clear token → `worktual:campaign-ready` → retry once |
| 2 | **Chrome** — `worktual.campaignEmbed` session flag; no sidebar/header on all sub-routes |
| 3 | **READY** — `worktual:campaign-ready` posted on load and pathname change (even if JWT cached); `path` includes search |
| 3b | **LOCATION** — `worktual:campaign-location` on every iframe path/search change so CRM can deep-link `/marketing/...` |
| 4 | **CSP** — `frame-ancestors` allows CRM parent origins |
| 5 | **Entitlement** — org must have active **Campaign** product (`campaign.organization_products`); CRM users need `setup_user_product_access.product_id = crm` (any role); no per-user campaign row |
| 6 | **Fallback** — `?crm_token=` on load still supported |

Design for **short JWT TTL (~15 min)** + CRM refresh every ~8 min, not long-lived tokens.

### Embed URL

```
http://192.168.11.31:5173/dashboard?embed=1
```

Other deep links work, e.g. `/campaigns/create?embed=1`.

### Token handoff (preferred: postMessage)

1. CRM iframes Campaign URL with `?embed=1`.
2. Campaign iframe posts `{ type: "worktual:campaign-ready" }` to CRM parent.
3. CRM responds with:

```javascript
iframe.contentWindow.postMessage(
  { type: "worktual:campaign-auth", token: crmAccessJwt },
  "http://192.168.11.31:5173",
);
```

Parent origin must be in allowlist: `http://localhost:5173` (default). Configure via `VITE_CRM_EMBED_ORIGINS` on Campaign frontend.

Token is stored in **sessionStorage only** (not localStorage). Standalone Portal login still uses localStorage + Campaign JWT unchanged.

### Token refresh

Campaign keeps a **lifetime** `message` listener. CRM should post `{ type: "worktual:campaign-auth", token }` whenever the JWT is renewed (~every 8–15 min). Campaign overwrites sessionStorage on each message. On API **401** with an expired embed token, Campaign clears the token, sends `worktual:campaign-ready`, waits for a fresh JWT, and **retries the request once**.

### CRM reveal handshake (no white flash)

CRM keeps the iframe hidden until Campaign sends **`worktual:campaign-ready`** with `{ path }` **after** real content is painted — not during auth bootstrap or route skeletons.

| Direction | Message | When |
|-----------|---------|------|
| Campaign → CRM | `worktual:campaign-ready` | After auth + page content painted (pathname change). `path` is full iframe location (pathname + search, `embed=1`). |
| Campaign → CRM | `worktual:campaign-location` | Every iframe path/search change. CRM rewrites `/marketing/...`. **Do not** echo as navigate. |
| CRM → Campaign | `worktual:campaign-auth` | On load + every ~8 min |
| CRM → Campaign | `worktual:campaign-navigate` | Tab switch only — `{ path: "/campaigns?embed=1" }` (client-side nav, no reload). Keep ids when the CRM URL has them. |

Implementation: `frontend/src/components/embed/CampaignEmbedBridge.tsx`, `frontend/src/lib/embed-auth.ts`.

Embed mode shows blank `#f3f4f6` (no Campaign skeleton/login) until ready.

**postMessage auth must not re-bootstrap when token unchanged** — duplicate `worktual:campaign-auth` (e.g. after `?crm_token=` load) previously triggered full auth reload and blanked the iframe; fixed in `main.tsx` + `refreshEmbedSession`.

### Token handoff (fallback: query param)

```
http://192.168.11.31:5173/dashboard?embed=1&crm_token=<CRM_ACCESS_JWT>
```

Campaign strips `crm_token` from the URL immediately (`history.replaceState`). Prefer postMessage in production.

### `embed=1` chrome

With `?embed=1`, Campaign hides its **sidebar and top header** so CRM Marketing chrome remains. Without the flag, full Portal UI as today.

The embed flag is **persisted in sessionStorage** for the iframe session (`worktual.campaignEmbed`, or CRM JWT in `worktual.campaign.embed-jwt`) so internal client-side navigation (e.g. Create Campaign → Template library) does not drop chrome hiding when `?embed=1` leaves the URL.

### Framing (CSP)

Vite dev server sets `Content-Security-Policy: frame-ancestors 'self' http://localhost:5173 http://127.0.0.1:5173`. Production static host must set the same (not `*`). No DB changes.

### Invalid token in embed

If CRM JWT is missing/invalid after handoff, Campaign shows the **normal login page** (`/login?embed=1`) — email/password flow unchanged.

## Endpoints CRM uses (API — Path A)

Base URL: `http://192.168.11.31:3001/api`

### Embed session exchange (optional handshake)

```http
POST /embed/session
Authorization: Bearer <CRM_ACCESS_JWT>
```

Returns **200** `{ ok: true, user: { ... } }` when all 6 CRM connect steps pass. Same validation as Bearer JWT on other `/api/*` routes. iframe auth still uses postMessage + sessionStorage (Path A).

### List campaigns

```http
GET /campaigns?bucket=all
Authorization: Bearer <CRM_ACCESS_JWT>
```

`bucket` values: `live` | `scheduled` | `past` | `draft` | `all` | `calendar`

### Create campaign

```http
POST /campaigns
Authorization: Bearer <CRM_ACCESS_JWT>
Content-Type: application/json

{
  "name": "CRM-initiated campaign",
  "description": null,
  "goal": null,
  "objective": null,
  "status": "draft",
  "startsAt": null,
  "endsAt": null
}
```

Only `name` is required. Do **not** send `tenantId` or `organization_id` in the body.

## Sample curl

```bash
# List
curl -sS 'http://192.168.11.31:3001/api/campaigns?bucket=all' \
  -H 'Authorization: Bearer <CRM_ACCESS_JWT>'

# Create
curl -sS -X POST 'http://192.168.11.31:3001/api/campaigns' \
  -H 'Authorization: Bearer <CRM_ACCESS_JWT>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"CRM-initiated campaign","status":"draft"}'
```

## HTTP status codes

| Code | Meaning |
|------|---------|
| **401** | Missing/invalid/expired CRM JWT, inactive user, or `CRM_JWT_ACCESS_SECRET` not set |
| **403** | Valid user but no organization, no branch, or Campaign product not enabled for org |
| **200/201** | Success — same response shapes as Campaign SPA |

## What CRM does NOT need

- Campaign login (`POST /api/auth/login`) — password not available
- Token exchange (`POST /api/auth/exchange`) — not implemented; not required
- Campaign `JWT_SECRET` — CRM never signs Campaign tokens
- `MARKETING_MS_TOKEN` — not used

## What is unchanged (Campaign SPA)

- Vite UI on `:5173`
- `POST /api/auth/login` (email/password → Campaign JWT)
- CRM JWT accepted on all SPA API routes (SPA JWT first)
- Create/list request and response shapes unchanged

## Deployment checklist (Campaign team)

- [ ] `npm run build` in `backend/`
- [ ] `CRM_JWT_ACCESS_SECRET` set from CRM `JWT_ACCESS_SECRET`
- [ ] `CRM_JWT_ISSUER=worktual-crm`, `CRM_JWT_USER_ID_CLAIM=sub`
- [ ] API restarted on `192.168.11.31:3001`
- [ ] Test user on org `1000` with Campaign product identified
- [ ] End-to-end curl with real CRM access JWT
- [ ] `CRM_INTEGRATION_KEY` set; curl `POST /api/campaigns/personalised-crm/automation` with `X-Crm-Integration-Key`

## Troubleshooting

| Symptom | Check |
|---------|-------|
| 401 on valid CRM user | `CRM_JWT_ACCESS_SECRET` matches CRM; `iss=worktual-crm`; `sub` = Accounts user id |
| 403 "CRM product access is required" | User missing `setup_user_product_access` row with `product_id = crm` |
| 403 "Campaign product is not enabled" | Org needs active `campaign` product in Campaign DB (not auto-created for CRM JWT) |
| 403 "no organization" | User row in `accounts.setup_users` missing `organization_id` |
| CRM JWT works on API but iframe blank | Check `frame-ancestors` / CRM parent origin in `VITE_CRM_EMBED_ORIGINS` |
| Iframe loads but shows login | CRM JWT not sent, wrong secret, or `sub` not in Campaign Accounts |
| AI Co-worker "Connection rejected" | Agents `:8005` needs same `CRM_JWT_ACCESS_SECRET` as API; run `npm run sync:crm-jwt` then **restart agents** (running process keeps old env) |
| CRM embed chat check | `npm run check:crm-embed -- <LAN_IP>` (HTTP + CRM JWT socket smoke) |
| 401 on `/personalised-crm/automation` | `X-Crm-Integration-Key` must equal `CRM_INTEGRATION_KEY` (not `CRM_JWT_ACCESS_SECRET`); restart API after env change |
| 400 unknown organization / acting user | `organization_id` exists in Accounts; `acting_user_id` is active in that org |

## Implementation references (Campaign repo)

| File | Purpose |
|------|---------|
| `backend/src/middlewares/authendication.ts` | `validateSession` / `validateCampaignAccess` (SPA JWT first, CRM fallback) |
| `backend/src/helpers/internal-service-auth.ts` | `requireCrmIntegrationKey` (`X-Crm-Integration-Key`) |
| `backend/src/dao/crm-access.ts` | CRM connect steps 2–4 (user, active, product_id crm); `assertCrmAutomationActor` |
| `backend/src/dao/crm-session.ts` | CRM session build (steps 2–6); `buildSessionFromCrmAutomation` |
| `backend/src/dao/entitlements.ts` | `requireCampaignEntitlementForCrm` (step 5, no auto-provision) |
| `backend/src/modules/embed/routes.ts` | `POST /api/embed/session` |
| `backend/src/services/crm-jwt.ts` | CRM JWT verification (step 1) |
| `backend/src/dao/auth.ts` | `getSessionUserFromCrmAccess` |
| `frontend/src/lib/embed-auth.ts` | iframe token handoff + `embed=1` detection |
| `agents/app/auth.py` | Socket.IO JWT — SPA JWT first, CRM embed JWT fallback |
| `frontend/vite.config.ts` | `frame-ancestors` for CRM embed |
