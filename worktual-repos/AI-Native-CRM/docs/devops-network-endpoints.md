# Worktual CRM — DevOps network & endpoint map

**Server IP:** `82.113.92.49`  
**Product:** AI-Native CRM (Fastify API + Vite web + ai-service)  
**DNS (suggested):** `crm.<your-domain>` → A record → `82.113.92.49`

Replace `http://82.113.92.49` with `https://crm.<your-domain>` after TLS is configured.

---

## Port map

| Port | Service | Type | Public? | Notes |
|------|---------|------|---------|-------|
| **5173** | nginx (`web` container) | HTTP — CRM Web UI | **Yes** | SPA; same port as local Vite dev |
| **4000** | Fastify CRM API | HTTP REST | **Yes** | CCaaS + integrations; Fastify listens on 4000 |
| **4001** | nginx (`web` container) | Socket.IO | **Yes** | Dedicated socket port; polls Fastify on internal 4000 |
| **443** | nginx + TLS | HTTPS | **Yes** | Recommended after DNS + certificate |
| **8000** | ai-orchestrator (Python) | HTTP API | **No** | Internal only — CRM backend calls it |
| **8010** | ai-mcp (Python) | HTTP MCP | **No** | Internal only — `/mcp/v1` |
| **6379** | Redis | TCP | **No** | Internal cache / pub-sub |

Legacy port **80** is no longer the primary CRM entry — use **5173** for web and **4000** for API.

Host **80** is kept as a legacy alias → container **5173** (same SPA) until DNS/TLS cutover.

---

## Health checks (load balancer)

| Type | Port | Path | Full URL (via web nginx) | Full URL (direct API) |
|------|------|------|--------------------------|------------------------|
| API | 5173 | `/health` | `http://82.113.92.49:5173/health` | `http://82.113.92.49:4000/health` |
| API | 5173 | `/ready` | `http://82.113.92.49:5173/ready` | `http://82.113.92.49:4000/ready` |
| OpenAPI | 4000 | `/docs` | — | `http://82.113.92.49:4000/docs` |
| ai-service | 8000 | `/health` | — internal | do not expose publicly |

---

## Appointments API (CCaaS integration — **expose publicly**)

Base: `http://82.113.92.49:4000`

Auth headers (CCaaS):

```http
x-internal-secret: 2b179c0d739539750168566ca295a7df
x-organization-id: 1000
Content-Type: application/json
```

| Method | Path | Type | Full URL |
|--------|------|------|----------|
| `GET` | `/api/appointments/availability` | API | `http://82.113.92.49:4000/api/appointments/availability` |
| `POST` | `/api/appointments` | API | `http://82.113.92.49:4000/api/appointments` |
| `GET` | `/api/appointments/by-contact/{contactId}` | API | `http://82.113.92.49:4000/api/appointments/by-contact/9` |
| `PATCH` | `/api/appointments/{id}` | API | `http://82.113.92.49:4000/api/appointments/{id}` |
| `POST` | `/api/appointments/{id}/cancel` | API | `http://82.113.92.49:4000/api/appointments/{id}/cancel` |

Browser UI may also reach `/api/*` via web nginx on `:5173`.

---

## CRM REST API (browser + integrations)

All **API** type. Prefix `/api/*` on port **4000** (or `:5173/api/*` via web nginx).

| Prefix | Purpose | Example full URL |
|--------|---------|------------------|
| `/api/auth` | Login, session, Accounts onboarding mint/exchange | `https://rebuild-crm.worktual.com/api/auth/login` |
| `/api/contacts` | Contacts CRUD | `http://82.113.92.49:4000/api/contacts` |
| `/api/companies` | B2B accounts | `http://82.113.92.49:4000/api/companies` |
| `/api/sales` | Deals, quotes, proposals | `http://82.113.92.49:4000/api/sales/deals` |
| `/api/finance` | Invoices | `http://82.113.92.49:4000/api/finance/invoices` |
| `/api/commerce` | B2C orders | `http://82.113.92.49:4000/api/commerce/orders` |
| `/api/products` | Catalog overlays | `http://82.113.92.49:4000/api/products` |
| `/api/activities` | Timeline | `http://82.113.92.49:4000/api/activities` |
| `/api/inbox` | Email inbox | `http://82.113.92.49:4000/api/inbox` |
| `/api/calendar` | Calendar | `http://82.113.92.49:4000/api/calendar/events` |
| `/api/configuration` | Settings, API keys | `http://82.113.92.49:4000/api/configuration` |
| `/api/notifications` | Notification bell | `http://82.113.92.49:4000/api/notifications` |
| `/api/coworker` | AI coworker REST | `http://82.113.92.49:4000/api/coworker` |
| `/api/agents` | Agent runs | `http://82.113.92.49:4000/api/agents` |
| `/api/meeting-assist/sessions` | Live meeting assist | `http://82.113.92.49:4000/api/meeting-assist/sessions` |
| `/api/google/oauth/callback` | Google OAuth redirect | `http://82.113.92.49:4000/api/google/oauth/callback` |
| `/api/microsoft/oauth/callback` | Microsoft OAuth redirect | `http://82.113.92.49:4000/api/microsoft/oauth/callback` |

**Internal only** (VPN / private network — do not expose to internet):

| Prefix | Purpose |
|--------|---------|
| `/api/internal/*` | Agent workers, MCP bridge |
| `/api/cron/*` | Scheduled jobs (Bearer `CRON_SECRET`) |

Notable cron paths (daily unless noted):

| Path | Purpose |
|------|---------|
| `/api/cron/invoice-escalation` | Overdue invoice collections agent |
| `/api/cron/contract-renewals` | Open renewal deals for expiring contracts |
| `/api/cron/billing-schedules` | Generate draft invoices from billing schedule rows |

---

## Server-Sent Events (SSE)

Long-lived **GET** streams. nginx: disable buffering (`proxy_buffering off` — already in `deploy/nginx.conf`).

| Path | Type | Full URL | Auth |
|------|------|----------|------|
| `/api/notifications/events` | SSE | `http://82.113.92.49:4000/api/notifications/events` | Session cookie (admin) |
| `/api/contacts/{id}/summary/events` | SSE | `http://82.113.92.49:4000/api/contacts/9/summary/events` | Session cookie |
| `/api/contacts/{id}/enrichment/events` | SSE | `http://82.113.92.49:4000/api/contacts/9/enrichment/events` | Session cookie |
| `/api/agents/{agentId}/runs/{jobId}/events` | SSE | `http://82.113.92.49:4000/api/agents/enrich/runs/{jobId}/events` | Session cookie |
| `/api/meeting-assist/sessions/{sessionId}/events` | SSE | `http://82.113.92.49:4000/api/meeting-assist/sessions/{sessionId}/events` | Session / panel JWT |

Response header: `Content-Type: text/event-stream`

---

## WebSocket / Socket.IO

| Path | Type | Full URL | Notes |
|------|------|----------|-------|
| `/socket-io/` | Socket.IO (polling) | `http://82.113.92.49:4001/socket-io/` | Dedicated public socket port |
| `/socket-io/` | Socket.IO (browser) | `http://82.113.92.49:5173/socket-io/` | Same-origin for SPA session cookies |
| `/api/meeting-assist/sessions/{sessionId}/stt/stream` | WebSocket | `ws://82.113.92.49:4000/api/meeting-assist/sessions/{sessionId}/stt/stream` | **Disabled** — returns unauthorized |

nginx listens on **4001** for socket-only traffic and **5173** for SPA + proxied `/socket-io/` (see `deploy/nginx.conf`).

---

## Inbound webhooks (external providers → CRM)

Must be reachable from **Google**, **Microsoft**, **Zoom** on public HTTPS after DNS+TLS.

| Method | Path | Type | Full URL |
|--------|------|------|----------|
| `POST` | `/api/webhooks/gmail/push` | API | `https://crm.<domain>/api/webhooks/gmail/push` |
| `POST` | `/api/webhooks/google-meet/transcript` | API | `https://crm.<domain>/api/webhooks/google-meet/transcript` |
| `POST` | `/api/webhooks/google-meet/transcript-push` | API | `https://crm.<domain>/api/webhooks/google-meet/transcript-push` |
| `POST` | `/api/webhooks/teams/transcript` | API | `https://crm.<domain>/api/webhooks/teams/transcript` |
| `POST` | `/api/webhooks/teams/transcript-notifications` | API | `https://crm.<domain>/api/webhooks/teams/transcript-notifications` |
| `POST` | `/api/webhooks/teams/transcript-lifecycle` | API | `https://crm.<domain>/api/webhooks/teams/transcript-lifecycle` |
| `POST` | `/api/webhooks/teams/transcript-subscription` | API | `https://crm.<domain>/api/webhooks/teams/transcript-subscription` |
| `POST` | `/api/webhooks/zoom/transcript` | API | `https://crm.<domain>/api/webhooks/zoom/transcript` |
| `POST` | `/api/webhooks/zoom/rtms` | API | `https://crm.<domain>/api/webhooks/zoom/rtms` |
| `POST` | `/api/webhooks/meeting-bot/recall` | API | `https://crm.<domain>/api/webhooks/meeting-bot/recall` |

---

## Static web UI

| Port | Path | Type | Full URL |
|------|------|------|----------|
| 5173 | `/` | Static SPA | `http://82.113.92.49:5173/login` |
| 80 | `/` | Static SPA (legacy alias) | `http://82.113.92.49/login` |

Local dev uses the same port: `npm run dev:web` → **5173**.

---

## DNS & TLS checklist for DevOps

1. **A record:** `crm.<domain>` → `82.113.92.49`
2. **TLS certificate** on nginx (443) when ready
3. **Open firewall:** **5173**, **4000**, **4001** (and **443** after TLS)
4. **Keep closed:** 8000, 8010, 6379, 5432
5. **Set env on server** (`deploy/.env`):
   - `WEB_PORT=5173`
   - `API_PORT=4000`
   - `SOCKET_PORT=4001`
   - `NEXT_PUBLIC_APP_URL=http://82.113.92.49:5173` (or HTTPS domain)
   - `FRONTEND_ORIGIN=http://82.113.92.49:5173`
   - `GOOGLE_REDIRECT_URI=.../api/google/oauth/callback`
   - `MICROSOFT_REDIRECT_URI=.../api/microsoft/oauth/callback`
6. Register OAuth redirect URIs in Google Cloud + Azure with the same URLs
7. **Redeploy** web + api images after pulling this change

---

## CCaaS handoff summary

After DNS + TLS, give CCaaS team:

| Item | Value |
|------|--------|
| Base URL | `http://82.113.92.49:4000` |
| Appointments | `http://82.113.92.49:4000/api/appointments` |
| Secret header | `x-internal-secret: 2b179c0d739539750168566ca295a7df` |
| Org header | `x-organization-id: 1000` |

Detailed booking curls: [`appointments-booking-scenarios.md`](appointments-booking-scenarios.md)
