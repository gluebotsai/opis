# Server deploy checklist (QA)

Use this every time you copy or update code on the server (e.g. `/home/Web_tracking/web_tracking_QA`).

## Will the old problems happen again?

| Issue | Happens again if… | Prevent |
|-------|-------------------|---------|
| API won't start (`bcrypt`, `tsx`) | You run `npm install` / `npm run dev` in `api-node` | Always use **Yarn** + `enableScripts: true` |
| Dashboard "Unable to reach API" | `.env` has `VITE_API_URL=http://localhost:7861` baked at build | Leave unset or use public API URL; rebuild web. Runtime falls back to same-origin `/api` for loopback URLs. |
| run_backend starts `yarn dev` / esbuild errors | `RUN_BACKEND` unset when picking commands | Set `RUN_BACKEND=1` in `.env`; ensure `api-node/dist` and `web/dist` exist |
| Vite "host not allowed" | `vite.config.js` missing `allowedHosts` | Keep `backend_qatracking` in allowed hosts |
| Swagger public URL 404 | Expect `/api/docs` but app serves `/docs` | Use `127.0.0.1:7861/docs` or mount swagger under `/api/docs` |
| Redis log spam | `REDIS_URL` set but Redis not running | Comment out `REDIS_URL` |
| Login 500 | PostgreSQL unreachable | Server must reach `DATABASE_URL` host |
| API `ERR_MODULE_NOT_FOUND` | `bcryptjs` missing after git pull | `cd api-node && yarn install` (package uses **bcryptjs**, not bcrypt) |

---

## One-time / after every code update

```bash
cd /home/Web_tracking/web_tracking_QA

# API (Yarn only — never npm in api-node)
cd api-node
corepack enable
# .yarnrc.yml must contain:
#   nodeLinker: node-modules
#   enableScripts: true
rm -rf node_modules
yarn install
yarn prisma generate

# Frontend
cd ../web
yarn install
```

---

## Server `.env` (QA)

```env
SERVICE_HOST=0.0.0.0
API_PORT=7861
WEB_PORT=7862
INGEST_PORT=7860
AI_CHAT_PORT=7863

# Dashboard → API (pick ONE approach)
# A) Cross-domain (your nginx split):
VITE_API_URL=https://qatrackingapi.worktual.com
CORS_ORIGINS=https://qatracking.worktual.com
# B) Same-origin via Vite proxy — comment out VITE_API_URL instead

VITE_ALLOWED_HOSTS=qatracking.worktual.com,backend_qatracking,.worktual.com
VITE_AI_CHAT_WS_URL=wss://qatrackingapi.worktual.com/chat/ws/chat
INGEST_PUBLIC_URL=https://qatrackingapi.worktual.com/webtracking/v1/tracking/nfs-ingestions
SDK_PUBLIC_URL=https://qatracking.worktual.com

# Optional — comment out if Redis not installed
# REDIS_URL=redis://localhost:6379

# Analytics insights (api-node → AI_CHAT internal HTTP)
INSIGHTS_INTERNAL_KEY=change-me-insights-internal-key
AI_CHAT_INSIGHTS_URL=http://127.0.0.1:7863/insights/generate
INSIGHTS_CACHE_TTL_SECONDS=600

# ClickHouse (analytics events) — colocated with Postgres on 10.180.0.126
CLICKHOUSE_HOST=10.180.0.126
CLICKHOUSE_PORT=8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=your_password
CLICKHOUSE_DATABASE=web_tracking

# Dictionary → Postgres (same host as CLICKHOUSE_HOST)
CH_DICT_PG_HOST=10.180.0.126
CH_DICT_PG_DB=worktual_bigint
CH_DICT_PG_SCHEMA=public
CH_DICT_PG_TABLE=admin_accounts
CH_DICT_PG_USER=ch_sync
CH_DICT_PG_PASSWORD=your_password
```

Set the same `INSIGHTS_INTERNAL_KEY` in **both** root `.env` (api-node) and `AI_CHAT/.env`. If unset, insights still work using the code fallback (no LLM narrative).

Restart **web** after any `VITE_*` change (baked at startup).

---

## DNS / nginx roots (do not mix)

| Public root | Port | Backend paths |
|-------------|------|----------------|
| `qatracking.worktual.com/` | 7862 | Dashboard (Vite) |
| `qatrackingapi.worktual.com/api` | 7861 | `/api/auth/*`, `/api/analytics/*`, … |
| `qatrackingapi.worktual.com/webtracking` | 7860 | strip prefix → `/v1/tracking/*` |
| `qatrackingapi.worktual.com/chat` | 7863 | strip prefix → `/ws/chat`, `/insights/generate`, etc. |

New backend features → suffix under `/api/...` only.

---

## Run services (4 terminals)

```bash
# 1 — API
cd api-node && yarn dev

# 2 — Frontend
cd web && yarn dev

# 3 — Ingest
cd .. && python etl/run_ingest.py

# 4 — Chat
cd AI_CHAT && python -m uvicorn app.main:app --host 0.0.0.0 --port 7863
```

Production API (no tsx):

```bash
cd api-node && yarn build && yarn start
```

---

## Verify after deploy

```bash
curl http://127.0.0.1:7861/health
curl -s -o /dev/null -w "web: %{http_code}\n" http://127.0.0.1:7862/
curl -s -X POST http://127.0.0.1:7861/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"YOUR_EMAIL","password":"YOUR_PASSWORD"}'
# After login, test insights (replace TOKEN):
# curl -H "Authorization: Bearer TOKEN" "http://127.0.0.1:7861/api/analytics/insights?period=month"
```

- `7861` fails → API not running (check `yarn dev`, bcrypt/Yarn scripts)
- Login 500 → PostgreSQL / `DATABASE_URL`
- Browser fails but curl OK → `.env` `VITE_API_URL` or CORS

---

## Files that must exist on server (not just local)

- `api-node/.yarnrc.yml` — `enableScripts: true`
- `web/vite.config.js` — `allowedHosts` + optional `/api` proxy
- `web/src/api.js` — `VITE_API_URL || ''` (not hardcoded localhost)
- Root `.env` — production values above

Do **not** copy `node_modules` from another machine. Always `yarn install` on the server.
