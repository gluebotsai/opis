# CRM iframe setup (current)

Quick reference for **how Worktual CRM embeds Campaign today** — iframe URL, `postMessage` contract, auth, and co-worker socket. For **live UI per module** (Create campaign, Drafts, Dashboard), see [CRM_IFRAME_UI_MODULES.md](CRM_IFRAME_UI_MODULES.md). For **tab-switch socket / “Still connecting…”** root cause and CRM reply text, see [CRM_EMBED_SOCKET_JOIN_FIX.md](CRM_EMBED_SOCKET_JOIN_FIX.md). For full API auth and deployment detail, see [CRM_CAMPAIGN_INTEGRATION.md](CRM_CAMPAIGN_INTEGRATION.md) and [CRM_CAMPAIGN_HANDOFF.md](CRM_CAMPAIGN_HANDOFF.md).

---

## Architecture (one picture)

```text
┌─────────────────────────────────────────────────────────────┐
│  CRM SPA (parent) — e.g. :5173/marketing/create             │
│  • Own sidebar chrome (Marketing / Create campaign / …)     │
│  • Address bar may show /marketing/... (CRM paths)          │
│  • Sends CRM access JWT → iframe via postMessage            │
└───────────────────────────┬─────────────────────────────────┘
                            │ <iframe> same or different origin
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Campaign SPA (iframe) — /campaigns/...?embed=1             │
│  • Hidden Campaign shell (no duplicate sidebar)               │
│  • JWT in sessionStorage: worktual.campaign.embed-jwt       │
│  • REST → /api (Bearer CRM JWT)                             │
│  • Co-worker → /agents-socket → agents :8005 (same JWT)     │
└─────────────────────────────────────────────────────────────┘
```

**Important:** CRM and Campaign are often **different hosts** in LAN (e.g. CRM `192.168.13.126:5173`, Campaign iframe `192.168.11.31:5173`). The parent URL `/marketing/...` is **not** where Campaign runs — only the iframe `src` / navigate target matters for API and WebSocket.

---

## What CRM must implement

### 1. iframe `src` (initial load)

Load Campaign with embed mode:

```text
https://<campaign-host>/campaigns/create?embed=1
```

Examples:

| CRM Marketing tab | Campaign iframe path |
|-------------------|----------------------|
| Create campaign (hub) | `/campaigns/create?embed=1` |
| Create draft chat | `/campaigns/create/{draftUuid}?embed=1` |
| Drafts | `/campaigns/create?tool=drafts&embed=1` |
| Dashboard | `/dashboard?embed=1` |
| Campaign monitor | `/campaigns?embed=1` (then `?tab=&id=` when a row is open) |
| Events tracking | `/events?embed=1` |
| Audience | `/audience?embed=1` → `/audience/{contactId}?embed=1` |

Use **HTTPS** in production (e.g. `https://rebuild-campaign.worktual.com/...?embed=1`).

### 2. Keep iframe mounted — no full reload on tab switch

When the user switches Marketing tabs (Create ↔ Monitor ↔ Events):

- **Do not** change iframe `src` to reload the document.
- Send **`worktual:campaign-navigate`** with the Campaign path (see below).
- Campaign runs **`router.push`** inside the iframe and keeps the **same Socket.IO connection** when possible.

### 3. postMessage protocol (required)

Origins: CRM parent origin must be listed in Campaign `VITE_CRM_EMBED_ORIGINS`. Campaign posts to each allowed parent origin.

| Direction | `type` | Payload | When |
|-----------|--------|---------|------|
| **CRM → Campaign** | `worktual:campaign-auth` | `{ "token": "<CRM_ACCESS_JWT>" }` | **Immediately** on iframe load, then on every JWT refresh (~8–15 min) |
| **CRM → Campaign** | `worktual:campaign-navigate` | `{ "path": "/campaigns?embed=1" }` | Marketing tab switch only (client route) |
| **Campaign → CRM** | `worktual:campaign-ready` | `{ "path": "/campaigns/create?embed=1" }` | After auth + page content painted (reveal handshake) |
| **Campaign → CRM** | `worktual:campaign-location` | `{ "path": "/campaigns/create/{id}?embed=1" }` | On iframe route/search change (deep link parent bar) |

**CRM reveal (no white flash):**

1. Keep iframe **hidden** (or loading overlay) until first `worktual:campaign-ready`.
2. On load, post **`worktual:campaign-auth`** before or as soon as the iframe loads.
3. Do **not** echo `worktual:campaign-location` back as `worktual:campaign-navigate` (causes loops / lost ids).

**Example (CRM parent — illustrative):**

```javascript
const CAMPAIGN_ORIGIN = "https://rebuild-campaign.worktual.com"; // iframe origin

// On iframe load + every refresh interval:
iframe.contentWindow.postMessage(
  { type: "worktual:campaign-auth", token: crmAccessJwt },
  CAMPAIGN_ORIGIN,
);

// Tab switch only:
iframe.contentWindow.postMessage(
  { type: "worktual:campaign-navigate", path: "/campaigns?embed=1" },
  CAMPAIGN_ORIGIN,
);

window.addEventListener("message", (event) => {
  if (event.origin !== CAMPAIGN_ORIGIN) return;
  if (event.data?.type === "worktual:campaign-ready") {
    showIframe();
  }
  if (event.data?.type === "worktual:campaign-location") {
    rewriteCrmUrlFromCampaignPath(event.data.path); // e.g. /marketing/create/{draftId}
  }
});
```

### 4. Parent URL mapping (ids in the address bar)

Campaign puts record ids in the **iframe** URL. CRM should listen to **`worktual:campaign-location`** and map without dropping ids:

| Campaign iframe `path` | Suggested CRM parent path |
|------------------------|---------------------------|
| `/campaigns/create/{draftId}?embed=1` | `/marketing/create/{draftId}` |
| `/campaigns?tab=live&id={campaignId}&embed=1` | `/marketing/campaigns?tab=live&id={campaignId}` |
| `/audience/{contactId}?embed=1` | `/marketing/audience/{contactId}` (or your convention) |

When CRM opens a deep link, navigate the iframe to the matching Campaign path **with `embed=1`**, not bare `/campaigns/create`.

### 5. Soft-nav resume (Create hub)

If CRM sends navigate to bare `/campaigns/create?embed=1`, Campaign may rewrite to the last active draft via session storage (`worktual.createCampaignActive.v2`) when the user had an in-progress draft — unless `hub=1` is set to force the hub UI.

---

## What Campaign implements (for CRM awareness)

| Piece | Behavior |
|-------|----------|
| `?embed=1` | Hides Campaign chrome; persists in `sessionStorage` (`worktual.campaignEmbed`) across in-iframe routes |
| Token storage | CRM JWT → `sessionStorage` key `worktual.campaign.embed-jwt` (not Campaign login `localStorage`) |
| `initEmbedAuth()` | Waits up to **4s** for first `worktual:campaign-auth` if no `crm_token` query param |
| `CampaignEmbedBridge` | READY after paint, location posts, listens for `worktual:campaign-navigate` |
| API | `Authorization: Bearer <CRM JWT>` — verifies with `CRM_JWT_*` on backend |
| Agents socket | Same JWT in Socket.IO `auth.token`; connect rejects without valid JWT |
| 401 recovery | Clears embed token, posts READY again, waits up to **15s** for new AUTH |

**Implementation files:** `frontend/src/lib/embed-auth.ts`, `frontend/src/components/embed/CampaignEmbedBridge.tsx`, `frontend/src/layouts/AppLayout.tsx`, `frontend/src/lib/create-campaign-active-session.ts`.

---

## JWT contract (CRM issuer ↔ Campaign verifier)

| Item | Value |
|------|--------|
| Secret | CRM `JWT_ACCESS_SECRET` = Campaign `CRM_JWT_ACCESS_SECRET` (backend **and** agents) |
| Issuer | `worktual-crm` (`CRM_JWT_ISSUER`) |
| User id | Claim `sub` = `accounts.setup_users.id` (string, e.g. `"1005"`) |
| Algorithm | HS256 |
| TTL | ~15 min — CRM should refresh and re-post **`worktual:campaign-auth`** before expiry |

Campaign **does not** use a token-swap endpoint; the iframe always uses the **CRM access JWT**.

---

## Environment (Campaign side)

### Backend `backend/.env`

```bash
CRM_JWT_ACCESS_SECRET="<same as CRM JWT_ACCESS_SECRET>"
CRM_JWT_ISSUER="worktual-crm"
CRM_JWT_USER_ID_CLAIM="sub"
CRM_JWT_ALGORITHM="HS256"
```

### Agents `agents/.env` (co-worker chat — required for Marketing hub)

```bash
CRM_JWT_ACCESS_SECRET="<same as above>"
CRM_JWT_ISSUER="worktual-crm"
CRM_JWT_USER_ID_CLAIM="sub"
CRM_JWT_ALGORITHM="HS256"
```

Without agents CRM JWT config, REST may work but Socket.IO shows **“Valid JWT token required to connect”**.

### Frontend `frontend/.env.local` / build-time

```bash
VITE_CRM_EMBED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://192.168.13.126:5173,https://rebuild-crm.worktual.com
```

Production static host / nginx must allow CRM origins in **`Content-Security-Policy: frame-ancestors`**.

---

## Co-worker (agents) in embed

| Topic | Detail |
|-------|--------|
| Socket URL | Same origin as Campaign SPA: `/agents-socket` (proxied to agents `:8005`) |
| Auth | JWT passed at connect: `io({ auth: { token } })` |
| Shared client | One Socket.IO client per iframe tab — hub, draft, and dashboard reuse it |
| Transport on tab switch | **Do not disconnect** `/agents-socket` for soft-nav when JWT unchanged; see [CRM_EMBED_SOCKET_JOIN_FIX.md](CRM_EMBED_SOCKET_JOIN_FIX.md) |
| Join | Each active module calls `join_session` with its `session_id` + `token` on the same socket (not a full reconnect) |
| Hub mode | Create hub uses `hub_mode: true` and ephemeral `hub-*` session id |
| Handoff to draft | Hub → create draft is **in-iframe** `router.push` + new `join_session` for draft id |

Debug: DevTools **inside the iframe** → Network → WS → `/agents-socket`. Expect connect → `join_session` → `session_ready`.

---

## Common errors (CRM + Campaign)

| User-visible message | Meaning | Fix |
|----------------------|---------|-----|
| **Valid JWT token required to connect** | Agents Socket.IO connect/join without a valid JWT in `auth.token` or join payload | CRM: post **`worktual:campaign-auth`** early and on refresh; ensure secret/`sub`/`iss` match on **agents** env |
| **Still connecting to co-worker — wait a moment, then send again.** | Transport up (`agents-socket` pings) but **`session_ready`** never arrived for this draft `session_id` — often after auth reconnect dropped an in-flight `join_session` | DevTools → filter **`agents-socket`** (All, not “worktual”) → WS Messages: expect **`join_session`** then **`session_ready`** with the same UUID as the URL. FE re-joins after reconnect (no full refresh required). |
| **Connecting to co-worker…** (pill) | Campaign agents **transport** not connected | Start agents; fix `/agents-socket` proxy; send AUTH before user chats |
| iframe blank / login | No embed JWT | Post AUTH; check `VITE_CRM_EMBED_ORIGINS` |
| 401 on `/api/auth/me` | Wrong secret or expired JWT | Align `CRM_JWT_*`; refresh AUTH |
| 403 product | Org lacks Campaign entitlement | Provision Campaign product for org |

---

## Dev-only fallback

Query param (stripped from URL after read):

```text
/campaigns/create?embed=1&crm_token=<CRM_ACCESS_JWT>
```

Production should use **`postMessage` only**.

---

## Checklist for CRM integrators

- [ ] iframe `src` uses Campaign host + `?embed=1`
- [ ] Post **`worktual:campaign-auth`** on load and every token refresh
- [ ] Listen for **`worktual:campaign-ready`** before showing iframe
- [ ] Listen for **`worktual:campaign-location`**; update parent URL with ids
- [ ] Tab switches use **`worktual:campaign-navigate`** — **no** iframe reload
- [ ] Do not echo location as navigate
- [ ] `postMessage` target origin = Campaign iframe origin
- [ ] Campaign backend + **agents** both have matching `CRM_JWT_*`

---

## Related docs

| Document | Use |
|----------|-----|
| [CRM_CAMPAIGN_INTEGRATION.md](CRM_CAMPAIGN_INTEGRATION.md) | Full integration, sequences, troubleshooting |
| [CRM_CAMPAIGN_HANDOFF.md](CRM_CAMPAIGN_HANDOFF.md) | API examples, deploy checklist |
| [CAMPAIGN_CRM_CONNECT_LOCAL_LIVE.md](CAMPAIGN_CRM_CONNECT_LOCAL_LIVE.md) | LAN / local + live wiring (if present) |
