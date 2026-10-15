# Docker deployment

Run Campaign on a public server with **Docker Compose**: nginx (SPA + reverse proxy), Fastify API, Python agents, and Redis.

PostgreSQL stays **external** (shared Worktual Accounts + Campaign DB) — point `backend/.env` at your real host.

## Prerequisites

- Docker Engine 24+ and Docker Compose v2
- PostgreSQL reachable from the server (`ACCOUNT_DATABASE_URL`, `DATABASE_URL`)
- Domain + TLS (Certbot on host, or a cloud load balancer in front of port 8080)

## 1. Configure environment

From the monorepo root (`worktual-campaign/` — folder with `frontend/`, `backend/`, `agents/`):

```bash
cp deploy/docker.env.example .env
cp backend/.env.example backend/.env
cp deploy/agents.env.example agents/.env
```

Edit **`.env`** (compose build/runtime):

| Variable | Example |
|----------|---------|
| `PUBLIC_APP_URL` | `https://campaign.yourdomain.com` |
| `CRM_EMBED_ORIGINS` | `https://crm.yourdomain.com,https://campaign.yourdomain.com` |
| `CRM_FRAME_ANCESTORS` | `https://crm.yourdomain.com https://campaign.yourdomain.com` (spaces for nginx CSP) |
| `WEB_PORT` | `8080` (host → web UI) |
| `API_PORT` | `3001` (host → campaign REST) |
| `SOCKET_PORT` | `3002` (host → campaign Socket.IO) |
| `AGENTS_PORT` | `8005` (host → agents Socket.IO + SFT catalog) |
| `AGENTS_HOST_BIND` | `127.0.0.1` (default) or `0.0.0.0` for remote SFT discovery |
| `RUN_DB_MIGRATE` | `1` on first deploy only |

Edit **`backend/.env`** — at minimum:

```bash
NODE_ENV=production
ACCOUNT_DATABASE_URL=postgresql://...
DATABASE_URL=postgresql://...?schema=campaign
CAMPAIGN_DATABASE_URL=postgresql://...?schema=campaign
JWT_SECRET=...
REDIS_URL=redis://redis:6379
CORS_ORIGIN=https://campaign.yourdomain.com
NEXT_PUBLIC_APP_URL=https://campaign.yourdomain.com
API_PUBLIC_URL=https://campaign.yourdomain.com
```

Edit **`agents/.env`** — ensure `JWT_SECRET` matches backend, LLM URLs are reachable, gallery images use a **public** API host, and **Hub A2A** is configured:

```bash
CAMPAIGN_API_BASE=http://backend:3001/api
CAMPAIGN_API_PUBLIC_BASE=https://campaign.yourdomain.com
# Hub registration (must match nginx path /a2a/)
A2A_PUBLIC_URL=https://campaign.yourdomain.com/a2a
ACCOUNT_DATABASE_URL=<same as backend>
A2A_SPOKE_CLIENT_ID=worktual-hub-campaign
A2A_SPOKE_CLIENT_SECRET=<shared with Hub team>
```

Full checklist: **`docs/CAMPAIGN_HUB_GO_LIVE.md`**. Skill reference: **`docs/CAMPAIGN_HUB_A2A_AGENT_CARD.md`**.

Edit **`backend/.env`** (or rely on Compose) so the API can reach agents inside Docker:

```bash
AGENTS_INTERNAL_URL=http://agents:8005
```

(`docker-compose.yml` sets this automatically for the backend service.)

Template Gallery **decisions + image/template generation** run in Python agents
(`POST /gallery/worker/process-job-chunk`). The TypeScript backend only enqueues
jobs, loads Prisma state, and applies mutations. Bootstrap is still **per logged-in
organization** (from the user session — no hardcoded org id). After deploy, sign in
and open **Create campaign → Templates**, or run:

```bash
npm run gallery:repair-media --workspace=backend   # clear stale localhost URLs (all orgs)
npm run gallery:bootstrap --workspace=backend -- --org-id=<from-db>
```

## 2. Build and start

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f web backend agents a2a
```

First-time database schema:

```bash
# Option A — set RUN_DB_MIGRATE=1 in .env, then up
# Option B — one-off:
docker compose run --rm backend npx prisma migrate deploy
```

Optional seed (run from host before Docker, or use a DB tool):

```bash
npm run db:seed --workspace=backend
```

## 3. Verify

```bash
curl http://localhost:8080/health
curl http://localhost:8080/docs
curl http://localhost:8080/a2a/health
curl -sS http://localhost:8080/a2a/.well-known/agent-card.json | head -c 400
```

Open `http://localhost:8080` (or your domain). Default seeded password: **`demo`** (see root `README.md`).

## Architecture

```text
Host ports (DevOps / edge nginx):
  :8080  web UI (SPA)
  :3001  campaign REST (/api, /health, /docs)
  :3002  campaign Socket.IO (/socket-io)
  :8005  agents Socket.IO (localhost; public path /agents-socket via web nginx)
  :8040  A2A spoke (localhost; public path /a2a via web nginx)

:8080 (web/nginx) also path-routes same-origin:
  ├── /              → SPA static (frontend/dist)
  ├── /api           → backend:3001
  ├── /socket-io     → backend:3002
  ├── /agents-socket → agents:8005 (rewrite → /socket-io)
  ├── /a2a/          → a2a:8040 (Hub agent card, token, message/send)
  └── /health, /docs → backend:3001

backend → Redis, PostgreSQL (external)
agents  → backend API, LLM gateway (external)
a2a     → backend API (Campaign JWT mint + skill execution)
```

## Public server (82.113.92.49)

Git **templates** in `deploy/server/` — not a secret vault. See **`deploy/server/README.md`**.

```bash
git checkout main
git pull origin main
chmod +x deploy/server/install-env.sh
./deploy/server/install-env.sh
# Backs up existing .env files to *.bak.<timestamp> before overwrite.
# Rebuild images so the SPA hash changes (pull alone keeps the old frontend).
docker compose build --no-cache web backend agents a2a
docker compose up -d
docker compose run --rm backend npx prisma migrate deploy
# Required for Events / dashboard agent-snapshot (20260929103000_campaign_opportunity_events).
# Confirm new frontend asset (must NOT stay index-DCqY4-U1.js):
curl -sS http://127.0.0.1:8080/ | grep -oE 'assets/index-[^"]+\.js'
```

Files: `deploy/server/root.env` → `.env`, `backend.env` → `backend/.env`, `agents.env` → `agents/.env`.

After first successful migrate, set `RUN_DB_MIGRATE=0` in `.env` and restart backend.

App URL: **http://82.113.92.49:8080** (browser). Hub A2A spoke (IP registration): **`http://82.113.92.49:8080/a2a`** (`A2A_PUBLIC_URL` in `agents.env`). Hub A2A server on same host: **`http://82.113.92.49:8030`**.

After `install-env.sh`, set **`A2A_SPOKE_CLIENT_SECRET`** + **`A2A_HUB_JWT_SECRET`**, ensure **`JWT_SECRET`** matches backend, then:

```bash
docker compose up -d --force-recreate a2a
curl -sS http://82.113.92.49:8080/a2a/health; echo
curl -sS http://82.113.92.49:8080/a2a/.well-known/agent-card.json \
  | python3 -c "import sys,json; c=json.load(sys.stdin); print(c['url'], c['tokenUrl'])"
```

Expect `"token_store": "db"` on health. Optional escalate: `HUB_A2A_CLIENT_ID` / `HUB_A2A_CLIENT_SECRET`.

---

## HTTPS

Compose exposes HTTP on `WEB_PORT`. Terminate TLS with one of:

- **Host nginx/Certbot** reverse-proxy to `127.0.0.1:8080`
- **Cloudflare / ALB** in front of the server
- Mount certs into the `web` service (custom nginx SSL block — not included by default)

## Roll back one commit on the server (then rebuild)

Use this if the latest `git pull` broke something and you want the **previous** commit running again.
Env files (`backend/.env`, `agents/.env`, `.env`) are **unchanged** — they are not in git.

```bash
cd /home/worktual/Campaign-Management/worktual-campaign/worktual-campaign

# See what you have now (example: f50c294 = latest, a27e535 = one back)
git log -3 --oneline

# Option A — script (reset HEAD~1 + build + up)
chmod +x deploy/server/rollback-one-and-run.sh
./deploy/server/rollback-one-and-run.sh

# Option B — manual
git reset --hard HEAD~1
docker compose build web backend agents
docker compose up -d
```

To **return to latest** after testing:

```bash
git fetch origin main
git reset --hard origin/main
docker compose build web backend agents
docker compose up -d
```

## Useful commands

```bash
docker compose down
docker compose build --no-cache web    # rebuild SPA after URL change
docker compose restart backend
docker compose exec backend sh
```

Rebuild the **web** image whenever `PUBLIC_APP_URL` or `CRM_EMBED_ORIGINS` changes (Vite bakes them at build time).

## Volumes

| Volume | Purpose |
|--------|---------|
| `backend_uploads` | Template/media uploads |
| `agents_data` | Agent session files (`DATA_DIR`) |
| `redis_data` | Cache / pub-sub |

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Blank login / API errors | `docker compose logs backend`; DB URLs from inside container |
| Agents chat fails | JWT test (`user_id_from_token`); `scripts/check-agents-socket.sh`; agents logs — **403 on :8005** means something bypassed `/agents-socket` (close extra tabs; agents port bound to `127.0.0.1` in compose); rebuild **web** after FE changes |
| CRM iframe blank | `CRM_FRAME_ANCESTORS` / `VITE_CRM_EMBED_ORIGINS`; CRM JWT vars in `backend/.env` |
| Email tracking broken / open·click rates stuck at 0 | `API_PUBLIC_URL` must be **public HTTPS** reachable from Gmail (prefer `https://rebuild-campaign-api.worktual.com` when UI/API are split). Redeploy backend after changing it — only **new** sends get the new pixel URLs. |

See also [docs/CAMPAIGN_MICROSERVICE.md](../docs/CAMPAIGN_MICROSERVICE.md) §12 Deployment checklist.
