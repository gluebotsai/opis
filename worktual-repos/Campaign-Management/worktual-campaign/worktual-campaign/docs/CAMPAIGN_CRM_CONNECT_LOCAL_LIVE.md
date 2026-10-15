# Campaign MS ↔ CRM — connect (local & live) + keys

How **Worktual CRM** connects to the **Campaign microservice** (iframe UI + REST API + agents chat).  
**Not** Hub A2A — see [CAMPAIGN_HUB_GO_LIVE.md](./CAMPAIGN_HUB_GO_LIVE.md).

**Deep dive:** [CRM_CAMPAIGN_INTEGRATION.md](./CRM_CAMPAIGN_INTEGRATION.md) · **CRM team curl:** [CRM_CAMPAIGN_HANDOFF.md](./CRM_CAMPAIGN_HANDOFF.md)

---

## 1. Integration summary

| Layer | Mechanism |
|--------|-----------|
| **UI** | CRM iframes Campaign SPA with `?embed=1` |
| **Auth** | CRM access JWT via `postMessage` (`worktual:campaign-auth`) — no password / token swap |
| **REST** | `Authorization: Bearer <CRM JWT>` on Campaign `/api/*` |
| **Agents** | Same CRM JWT on Socket.IO (create/monitor chat) |
| **Identity** | JWT `sub` = `accounts.setup_users.id`; tenant = user's `organization_id` |
| **Data** | Shared Postgres: `ACCOUNT_DATABASE_URL` (`accounts`, `cdp`) + Campaign `DATABASE_URL` (`campaign` schema) |

---

## 2. Keys & secrets — who owns what

### 2.1 Where the **real** values live (not in this doc)

Campaign docs use placeholders like `<paste CRM JWT_ACCESS_SECRET>`. There is **no** committed “original” CRM signing secret in git — by design.

| Value you need | Source of truth (where to copy) |
|----------------|----------------------------------|
| **`CRM_JWT_ACCESS_SECRET`** | **CRM team** — their backend env **`JWT_ACCESS_SECRET`**. Paste the **same string** into Campaign `backend/.env` and `agents/.env`. Until CRM shares it, templates use `change-me-access-secret-min-32-chars` (embed **will not** verify real CRM tokens). |
| **`CRM_JWT_ISSUER`** | Fixed: **`worktual-crm`** (confirm with CRM; do not invent). |
| **`CRM_JWT_USER_ID_CLAIM`** | Fixed: **`sub`**. |
| **`CRM_JWT_ALGORITHM`** | Fixed: **`HS256`**. |
| **`ACCOUNT_DATABASE_URL`** | Campaign **`backend/.env`** (or `deploy/server/backend.env` on server). Copy **identical** line into **`agents/.env`**. Same DB CRM uses for `accounts` / `cdp`. |
| **`JWT_SECRET`** | Campaign **`backend/.env`** only — standalone portal login. Copy same value into **`agents/.env`**. **Not** the CRM secret. |
| **Live CRM JWT for testing** | User logs into **CRM** → CRM mints access JWT → use in curl or iframe `postMessage` (short-lived ~15 min). Not an env var. |

**Local quick sync (after backend is configured):**

```bash
# From repo root — copy shared lines into agents (adjust paths if needed)
grep -E '^(ACCOUNT_DATABASE_URL|JWT_SECRET|CRM_JWT_)' backend/.env >> agents/.env
# Then dedupe / merge manually — agents/.env must not have two CRM_JWT_ACCESS_SECRET lines
```

**Files on disk (your machine):**

- `worktual-campaign/worktual-campaign/backend/.env`
- `worktual-campaign/worktual-campaign/agents/.env`
- Server templates: `deploy/server/backend.env`, `deploy/server/agents.env`

---

### 2.2 CRM team **provides** to Campaign (secure channel)

| CRM env / concept | Campaign must set | Must match |
|-------------------|-------------------|------------|
| `JWT_ACCESS_SECRET` (CRM backend) | `CRM_JWT_ACCESS_SECRET` | **Exact same string** |
| Issuer claim `iss` (typically `worktual-crm`) | `CRM_JWT_ISSUER=worktual-crm` | Same |
| User id claim (typically `sub`) | `CRM_JWT_USER_ID_CLAIM=sub` | Same |
| Algorithm (typically HS256) | `CRM_JWT_ALGORITHM=HS256` | Same |
| CRM parent origin(s) for iframe | `VITE_CRM_EMBED_ORIGINS` + `CRM_EMBED_ORIGINS` / `CRM_FRAME_ANCESTORS` | CRM SPA URL(s) |
| Test user + org | — | User in `accounts.setup_users`; org has Campaign product |

CRM does **not** need Campaign `JWT_SECRET` (standalone portal login).

### 2.3 Campaign team **sets** (backend)

| Key | Required for CRM | Notes |
|-----|------------------|--------|
| `CRM_JWT_ACCESS_SECRET` | **Yes** | Same as CRM `JWT_ACCESS_SECRET` |
| `CRM_JWT_ISSUER` | **Yes** | Default `worktual-crm` |
| `CRM_JWT_USER_ID_CLAIM` | **Yes** | Default `sub` |
| `CRM_JWT_ALGORITHM` | **Yes** | Default `HS256` |
| `ACCOUNT_DATABASE_URL` | **Yes** | Same cluster/DB CRM uses for users & CDP |
| `DATABASE_URL` / `CAMPAIGN_DATABASE_URL` | **Yes** | Campaign `campaign` schema |
| `JWT_SECRET` | Standalone portal only | **Different** from CRM secret; SPA login |
| `CORS_ORIGIN` | **Yes** | Include CRM + Campaign FE origins |
| `NEXT_PUBLIC_APP_URL` / `PUBLIC_APP_URL` | **Yes** | Campaign SPA public URL |
| `API_PUBLIC_URL` | Recommended live | Tracking links, media (HTTPS in prod) |
| `AGENTS_PREPARE_URL` | Optional | Hub/on-demand only; Docker: `http://a2a:8040` |

**File:** `backend/.env` (template: `backend/.env.example`, live: `deploy/server/backend.env`)

### 2.4 Campaign team **sets** (agents)

| Key | Required for CRM embed chat |
|-----|----------------------------|
| `CRM_JWT_ACCESS_SECRET` | **Yes** — must match backend |
| `CRM_JWT_ISSUER` | **Yes** |
| `CRM_JWT_USER_ID_CLAIM` | **Yes** |
| `CRM_JWT_ALGORITHM` | **Yes** |
| `ACCOUNT_DATABASE_URL` | **Yes** (same as backend) |
| `JWT_SECRET` | If agents call Campaign API |
| `CAMPAIGN_API_BASE` | Docker: `http://backend:3001/api` |

**File:** `agents/.env` (template: `agents/.env.example`, live: `deploy/server/agents.env`)

### 2.5 Campaign team **sets** (frontend)

| Key | Required for CRM iframe |
|-----|-------------------------|
| `VITE_CRM_EMBED_ORIGINS` | **Yes** — comma-separated CRM parent origins |
| `VITE_API_BASE_URL` | Dev: `/api` (proxy); prod: often `/api` on same host |
| `VITE_PUBLIC_APP_URL` | Campaign SPA URL (LAN script / live domain) |
| `VITE_SOCKET_URL` | Optional; dev often uses `/agents-socket` proxy |

**Files:** `frontend/.env.local` (dev), baked at **build** for Docker (`CRM_EMBED_ORIGINS` in root `.env`)

### 2.6 Docker / nginx (live)

| Key | File | Purpose |
|-----|------|---------|
| `CRM_EMBED_ORIGINS` | root `.env` (`deploy/server/root.env`) | Build-time FE allowlist |
| `CRM_FRAME_ANCESTORS` | root `.env` | nginx CSP `frame-ancestors` (space-separated) |
| `PUBLIC_APP_URL` | root `.env` | e.g. `https://rebuild-campaign.worktual.com` |

Rebuild **web** image after changing `CRM_EMBED_ORIGINS` or `PUBLIC_APP_URL`.

---

## 3. Copy-paste env blocks

### Local — Campaign `backend/.env`

```bash
ACCOUNT_DATABASE_URL="postgresql://USER:PASS@HOST:5432/worktual_bigint"
DATABASE_URL="postgresql://USER:PASS@HOST:5432/worktual_bigint?schema=campaign"

JWT_SECRET="change-me-campaign-spa-only"

# From CRM team — MUST match CRM JWT_ACCESS_SECRET
CRM_JWT_ACCESS_SECRET="<paste CRM JWT_ACCESS_SECRET>"
CRM_JWT_ISSUER="worktual-crm"
CRM_JWT_USER_ID_CLAIM="sub"
CRM_JWT_ALGORITHM="HS256"

PORT=3001
CORS_ORIGIN="http://localhost:5173,http://127.0.0.1:5173,http://192.168.13.126:5173"
NEXT_PUBLIC_APP_URL="http://localhost:5173"
API_PUBLIC_URL="http://localhost:3001"
```

### Local — Campaign `agents/.env`

```bash
ACCOUNT_DATABASE_URL="<same as backend>"

CRM_JWT_ACCESS_SECRET="<same as backend CRM_JWT_ACCESS_SECRET>"
CRM_JWT_ISSUER=worktual-crm
CRM_JWT_USER_ID_CLAIM=sub
CRM_JWT_ALGORITHM=HS256

JWT_SECRET="<same as backend JWT_SECRET>"
```

### Local — Campaign `frontend/.env.local`

```bash
VITE_API_BASE_URL=/api
VITE_CRM_EMBED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://192.168.13.126:5173
# Add your CRM LAN host if different, e.g. http://192.168.13.126:5173
```

### Live — Campaign (see `deploy/server/`)

```bash
# root.env
PUBLIC_APP_URL=https://rebuild-campaign.worktual.com
CRM_EMBED_ORIGINS=https://rebuild-crm.worktual.com,https://rebuild-campaign.worktual.com,http://82.113.92.49:8080
CRM_FRAME_ANCESTORS=https://rebuild-crm.worktual.com https://rebuild-campaign.worktual.com http://82.113.92.49:8080

# backend.env — CRM_JWT_* + real CRM_JWT_ACCESS_SECRET from CRM ops
CRM_JWT_ACCESS_SECRET="<production secret from CRM>"
CRM_JWT_ISSUER=worktual-crm
CRM_JWT_USER_ID_CLAIM=sub
CRM_JWT_ALGORITHM=HS256
```

---

## 4. URL matrix — local vs live

### Local / LAN (development)

| Surface | Example URL | Port |
|---------|-------------|------|
| CRM parent | `http://localhost:5173` or `http://192.168.13.126:5173` | 5173 |
| Campaign SPA (iframe) | `http://192.168.11.31:5173` or `http://localhost:5173` | 5173 |
| Campaign API | `http://localhost:3001/api` | 3001 |
| Agents Socket.IO | `http://localhost:8005` | 8005 |

**Start:**

```bash
npm run dev:backend
npm run dev:frontend
# agents: cd agents && PYTHONPATH=. .venv/bin/python -m uvicorn app.socket_server:app --host 0.0.0.0 --port 8005
```

**Iframe examples:**

```text
http://<CAMPAIGN_FE>:5173/campaigns/create?embed=1
http://<CAMPAIGN_FE>:5173/campaigns?embed=1
```

### Live (production example)

| Surface | URL |
|---------|-----|
| CRM | `https://rebuild-crm.worktual.com` |
| Campaign portal | `https://rebuild-campaign.worktual.com` |
| Campaign API | `https://rebuild-campaign-api.worktual.com/api` (or proxied `/api` on portal host) |
| Docker edge (example) | `http://82.113.92.49:8080` |

**Iframe:**

```text
https://rebuild-campaign.worktual.com/campaigns/create?embed=1
```

---

## 5. JWT contract (both teams align)

| Item | CRM (issuer) | Campaign (verifier) |
|------|--------------|---------------------|
| Signing secret | `JWT_ACCESS_SECRET` | `CRM_JWT_ACCESS_SECRET` |
| Issuer | `worktual-crm` | `CRM_JWT_ISSUER` |
| User id | `sub` = `accounts.setup_users.id` | `CRM_JWT_USER_ID_CLAIM=sub` |
| Algorithm | HS256 | `CRM_JWT_ALGORITHM=HS256` |
| TTL | ~15 min | CRM refreshes ~every 8 min via `postMessage` |

Auth order on Campaign API: try **Campaign SPA JWT** (`JWT_SECRET`) first, then **CRM JWT**.

**Entitlement:** `campaign.organization_products` (Campaign active for org) + user has CRM product access (`product_id = crm`). CRM path does not auto-create Campaign entitlement.

---

## 6. postMessage protocol

| Direction | Type | Payload |
|-----------|------|---------|
| Campaign → CRM | `worktual:campaign-ready` | `{ path: "/campaigns/create/...?embed=1" }` |
| Campaign → CRM | `worktual:campaign-location` | `{ path: "..." }` — sync parent URL |
| CRM → Campaign | `worktual:campaign-auth` | `{ token: "<CRM access JWT>" }` |
| CRM → Campaign | `worktual:campaign-navigate` | `{ path: "/campaigns?embed=1" }` — tab switch only |

**postMessage target origin:** Campaign iframe origin (e.g. `http://192.168.11.31:5173` or `https://rebuild-campaign.worktual.com`).

Dev fallback (not prod): `?embed=1&crm_token=<JWT>`.

---

## 7. Verify connection

### API (CRM or curl)

```bash
export CRM_JWT="<CRM access token>"
curl -sS -H "Authorization: Bearer $CRM_JWT" \
  "http://localhost:3001/api/auth/me" | jq .

curl -sS -H "Authorization: Bearer $CRM_JWT" \
  "http://localhost:3001/api/campaigns?bucket=live" | jq .
```

Live: replace host with `https://rebuild-campaign-api.worktual.com/api`.

| HTTP | Meaning |
|------|---------|
| 200 | JWT + user + entitlement OK |
| 401 | Wrong/expired JWT or `CRM_JWT_ACCESS_SECRET` mismatch |
| 403 | Missing CRM product row or org Campaign entitlement |

### Optional embed handshake

```http
POST /api/embed/session
Authorization: Bearer <CRM_ACCESS_JWT>
```

### Embed UI

1. CRM loads iframe with `?embed=1`.
2. Wait for `worktual:campaign-ready`.
3. Send `worktual:campaign-auth` with fresh CRM JWT.
4. Confirm `/api/auth/me` 200 in iframe network tab.

---

## 8. CRM team checklist (what they configure)

| Item | Action |
|------|--------|
| Share `JWT_ACCESS_SECRET` | Campaign sets `CRM_JWT_ACCESS_SECRET` |
| Confirm `iss=worktual-crm`, `sub=setup_users.id` | Match Campaign `CRM_JWT_*` |
| iframe `src` | Campaign URL + `?embed=1` |
| postMessage | AUTH on load + every ~8 min |
| Parent origin allowlist | Give Campaign team exact CRM origin(s) for `VITE_CRM_EMBED_ORIGINS` |
| Test user | Active user, org with Campaign product enabled |

---

## 9. Campaign team checklist (what we configure)

| Item | Action |
|------|--------|
| Set all `CRM_JWT_*` on **backend** and **agents** | Same secret as CRM |
| `ACCOUNT_DATABASE_URL` | Same DB as CRM accounts/CDP |
| `VITE_CRM_EMBED_ORIGINS` / `CRM_EMBED_ORIGINS` | Include all CRM parent URLs |
| `CRM_FRAME_ANCESTORS` (live nginx) | Space-separated same origins |
| Restart | backend + agents (+ rebuild web if embed origins changed) |

---

## 10. CRM vs Hub (do not mix)

| Integration | Auth | Entry URL |
|-------------|------|-----------|
| **CRM embed + API** | CRM access JWT | This document |
| **Hub on-demand** | OAuth client credentials | `http://<host>:8080/a2a/` — [CAMPAIGN_HUB_GO_LIVE.md](./CAMPAIGN_HUB_GO_LIVE.md) |

---

## 11. Troubleshooting

| Symptom | Check |
|---------|--------|
| iframe blocked / blank | `VITE_CRM_EMBED_ORIGINS`, `CRM_FRAME_ANCESTORS`, CRM origin exact match |
| 401 API | `CRM_JWT_ACCESS_SECRET` vs CRM `JWT_ACCESS_SECRET`; token expiry |
| 403 API | Campaign org product; user `product_id=crm` |
| Chat fails in embed | `CRM_JWT_*` on **agents**; Socket.IO URL / proxy |
| CORS | `CORS_ORIGIN` includes CRM + Campaign FE |

---

## 12. Related docs

- [CRM_CAMPAIGN_INTEGRATION.md](./CRM_CAMPAIGN_INTEGRATION.md)
- [CRM_CAMPAIGN_HANDOFF.md](./CRM_CAMPAIGN_HANDOFF.md)
- [CAMPAIGN_MICROSERVICE.md](./CAMPAIGN_MICROSERVICE.md)
- [deploy/README.md](../deploy/README.md) — Docker CRM embed vars
- [PERSONALISED_CRM_API.md](./PERSONALISED_CRM_API.md) — personalised CRM send API (if used)
