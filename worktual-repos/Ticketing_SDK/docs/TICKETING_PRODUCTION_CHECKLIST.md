# Ticketing spoke — production deployment checklist

Use when deploying API + SPA + agents as a standalone microservice (Campaign-style).

## Docker Compose (recommended on a VM)

```bash
cp .env.example .env   # set DATABASE_URL, JWT_SECRET, COWORKER_TASKS_SECRET,
                       # APP_URL, API_PORT=4000, WEB_PORT=3355, COOKIE_SECURE=1
docker compose up -d --build
curl -s http://127.0.0.1:4000/health
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3355/
```

Default stack: **web** `:3355` (SPA), **api** `:4000` (REST), **agents** internal `:8012`.
Optional bundled Postgres: `docker compose --profile local-db up -d --build`.

Put Nginx/Caddy + TLS in front. Host nginx must proxy SPA host `/api/` and `/uploads/` → `:4000`.
Default bind is `0.0.0.0` so `WEB_PORT` / `API_PORT` are reachable by server IP; set `WEB_BIND=127.0.0.1` and `API_BIND=127.0.0.1` if only host nginx should connect.

### Rebuild DNS (split SPA + API)

| Public URL | Nginx path prefix | Upstream | Service | Protocol notes |
|---|---|---|---|---|
| `https://rebuild-ticketing.worktual.com` | `/` | `127.0.0.1:3355` | `web` (Docker) | SPA—`try_files $uri /index.html` |
| `https://rebuild-ticketing-api.worktual.com/api/*` | `/api/` | `127.0.0.1:4000` | `api` (Docker) | REST—pass-through |

On the SPA host, also proxy `/api/` and `/uploads/` → `:4000` so relative browser fetches keep session cookies. Leave `:8012` private.

## Runnables

- [ ] **Ticketing API** — `TICKETING_API_ONLY=1`, published `:4000` (host and container)
- [ ] **Ticketing SPA** — static `ui-frontend/dist` behind CDN/reverse proxy, or Vite build served by API in production
- [ ] **Agent service** — `uvicorn app.main:app --host 0.0.0.0 --port 8012`
- [ ] **Postgres** — `ticketing` schema migrated; `accounts` read-only from Ticketing migrations

## Required secrets (production)

- [ ] `JWT_SECRET` — strong unique value (staff cookie JWT)
- [ ] `COWORKER_TASKS_SECRET` — matches agents + Express service-actor headers
- [ ] `DATABASE_URL` — ticketing schema connection
- [ ] `CRM_JWT_ACCESS_SECRET` — if CRM Path A embed/API is used
- [ ] `INTERNAL_SERVICE_KEY` — spoke-to-spoke intake (Campaign/Social/CCaaS)
- [ ] `WEBHOOK_SIGNING_SECRET` — outbound ticket event HMAC (or reuse `INTERNAL_SERVICE_KEY`)

## Optional integration

- [ ] `TICKETING_WEBHOOK_URL` — CRM/CCaaS consumer for outbox events
- [ ] `TICKETING_FRAME_ANCESTORS` — CSP `frame-ancestors` for CRM iframe (restrict to host origins)
- [ ] `TICKETING_API_URL` — SPA dev proxy target; production API public URL for agents (`EXPRESS_BASE_URL`)
- [ ] `COWORKER_AGENTS_URL` — Express → agents (`http://agents:8012`)
- [ ] `COWORKER_MODEL_URL` — LLM endpoint for co-worker

## Agent API boundary (Phase 3)

Agents default to HTTP-only business data (set to `0` only for legacy local debug):

- [ ] `CONVERSATION_CONTEXT_VIA_API=1`
- [ ] `AGENT_DATA_VIA_API=1` / `agent_data_via_api=1`
- [ ] `PROACTIVE_VIA_API=1` / `proactive_via_api=1`
- [ ] `EXPRESS_BASE_URL` points at Ticketing API (not agents)

## Health & observability

- [ ] `GET /health` → `{ service: "ticketing-backend", status: "ok", db: true }`
- [ ] `GET /docs` — OpenAPI/Swagger reachable on API host
- [ ] Agents `GET :8012/health`

## Smoke validation

```bash
API_BASE=https://ticketing-api.example npm run test:smoke
```

Expect spoke checks: `/health`, OpenAPI, `auth/me` modules, conversation-context service actor.

## Host products (CRM / CCaaS)

- [ ] CRM iframe: `?embed=1` + `postMessage { type: "worktual:ticketing-auth", token }`
- [ ] CCaaS intake: `POST /api/intake/tickets` (org key or `INTERNAL_SERVICE_KEY`)
- [ ] Handoff docs signed: [TICKETING_AUTH_HANDOFF.md](./TICKETING_AUTH_HANDOFF.md), [CRM_TICKETING_HANDOFF.md](./CRM_TICKETING_HANDOFF.md), [CCAAS_TICKETING_HANDOFF.md](./CCAAS_TICKETING_HANDOFF.md)

## Redis (optional)

Not required for v1. Session cache can remain in-memory/cookie JWT. Add Redis later if Accounts session cache is shared at platform level.
