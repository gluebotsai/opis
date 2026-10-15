# Build & run — local and QA

Full steps to run the contact centre locally or on the QA server.

See also: [env-files.md](./env-files.md) · [server-install.md](./server-install.md)

---

## Environment values

### Local

**Root `.env`**
```env
CORS_ORIGINS=http://localhost:5173
```

**`apps/web/.env`** (host dev with `npm run dev:web` only)
```env
VITE_CC_CORE_URL=http://localhost:3000
VITE_PLATFORM_SERVICE_URL=http://localhost:3001
VITE_NLP_SERVICE_URL=http://localhost:8000
VITE_SOCKET_URL=http://localhost:3000
```

For **Docker Compose full stack** locally, you can omit `VITE_*` in root `.env` — compose defaults to the same `localhost` URLs. Set them explicitly if you prefer.

### QA

**Root `.env`** on the server (used by Docker Compose build + backends):
```env
CORS_ORIGINS=https://rebuild-ccaas.worktual.com
VITE_CC_CORE_URL=https://rebuild-ccaas-api.worktual.com
VITE_PLATFORM_SERVICE_URL=https://rebuild-ccaas-api.worktual.com
VITE_NLP_SERVICE_URL=https://rebuild-ccaas-api.worktual.com
VITE_SOCKET_URL=https://rebuild-ccaas-api.worktual.com
VITE_CALL_SERVICE_URL=https://rebuild-ccaas-api.worktual.com/call-api
CALL_SERVICE_API_V1_PUBLIC_BASE=/call-api/v1
```

`VITE_*` values are **baked into the web image at build time**. Change them → rebuild the `web` service.

| Setting | Local | QA |
|---------|-------|-----|
| `CORS_ORIGINS` | `http://localhost:5173` | `https://rebuild-ccaas.worktual.com` |
| `VITE_CC_CORE_URL` | `http://localhost:3000` | `https://rebuild-ccaas-api.worktual.com` |
| `VITE_PLATFORM_SERVICE_URL` | `http://localhost:3001` | `https://rebuild-ccaas-api.worktual.com` |
| `VITE_NLP_SERVICE_URL` | `http://localhost:8000` | `https://rebuild-ccaas-api.worktual.com` |
| `VITE_SOCKET_URL` | `http://localhost:3000` | `https://rebuild-ccaas-api.worktual.com` |
| `VITE_CALL_SERVICE_URL` | `http://localhost:3003` | `https://rebuild-ccaas-api.worktual.com/call-api` |

### QA via public IP (before Nginx / DNS)

When opening the UI as `http://<SERVER_IP>:5173`, the browser must call APIs on the **same server IP** — not `localhost`. Add to root `.env` on the server (replace IP):

```env
CORS_ORIGINS=http://82.113.92.47:5173
VITE_CC_CORE_URL=http://82.113.92.47:3000
VITE_PLATFORM_SERVICE_URL=http://82.113.92.47:3001
VITE_NLP_SERVICE_URL=http://82.113.92.47:8000
VITE_SOCKET_URL=http://82.113.92.47:3000
```

Then rebuild **web** (VITE_* are baked in) and recreate **cc-core** + **nlp** (CORS):

```bash
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build web
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d cc-core nlp platform-service chat-service
sudo ufw allow 5173/tcp
sudo ufw allow 3000/tcp
sudo ufw allow 3001/tcp
sudo ufw allow 3002/tcp
sudo ufw allow 8000/tcp
```

Open: `http://82.113.92.47:5173`

When DevOps Nginx is live, switch back to the HTTPS QA URLs in the table above and rebuild `web`.

---

## Local development

Two ways to work locally. Pick one.

### Option A — Infra in Docker, apps on host (recommended for day-to-day dev)

Best for hot reload while coding.

**1. Prerequisites**
```bash
node --version    # 20+
npm --version     # 10+
docker compose version
```

**2. Install dependencies**
```bash
cd /path/to/ai_contact_center_2
npm install
```

**3. Configure env**
```bash
cp apps/web/.env.example apps/web/.env
# Edit root .env and apps/web/.env — use Local values from the table above
```

**4. Generate Prisma clients**
```bash
npm run db:generate
```

**5. Start infrastructure (Redis + Kafka)**
```bash
npm run docker:up
# Or include local Postgres: npm run docker:up -- --all
```

**6. Start all app services**
```bash
npm run dev
```

**7. Open the UI**

http://localhost:5173

**8. Health checks**
```bash
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
curl http://localhost:3004/health
curl http://localhost:8000/health
```

---

### Option B — Full stack in Docker (local “deploy-like” run)

Runs backends + web UI in containers. Rebuild after code changes.

**1. Prerequisites** — same as Option A.

**2. Install dependencies** (needed for Prisma / first-time setup)
```bash
npm install
npm run db:generate
```

**3. Configure root `.env`**

Use **Local** values from the table above. Minimum:
```env
CORS_ORIGINS=http://localhost:5173
DATABASE_URL=...
PLATFORM_DATABASE_URL=...
JWT_SECRET=...
# other secrets as needed
```

`VITE_*` optional — compose defaults to `http://localhost:3000` etc.

**4. Build and start**
```bash
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build
```

**5. Open the UI**

http://localhost:5173

**6. Health checks**
```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:8000/health
docker compose -f docker/docker-compose.qa.yml ps
```

**7. Rebuild after changes**
```bash
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build
```

**8. Stop**
```bash
docker compose -f docker/docker-compose.qa.yml down
```

> **Tip:** A full `up -d --build` builds every service and web is the slowest (`npm ci` + Vite). Use [build one service only](#build-one-service-only) or start backends first, then web.

---

## Build one service only

Use these from the **repo root**. Works for local Docker and QA.

Set a shorthand (optional):
```bash
export COMPOSE="docker compose -f docker/docker-compose.qa.yml --env-file .env"
```

### Build + start a single service

```bash
# Frontend only (slowest — full Vite production build)
$COMPOSE up -d --build web

# One backend only
$COMPOSE up -d --build cc-core
$COMPOSE up -d --build platform-service
$COMPOSE up -d --build chat-service
$COMPOSE up -d --build call-service
$COMPOSE up -d --build social-service
$COMPOSE up -d --build nlp

# Infra only
$COMPOSE up -d redis kafka
```

Without the shorthand:
```bash
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build web
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build cc-core
```

### Build image only (no restart)

```bash
$COMPOSE build web
$COMPOSE build cc-core
$COMPOSE build chat-service
```

### Start without rebuild (image already built)

```bash
$COMPOSE up -d web
$COMPOSE up -d cc-core
```

### Backends first, web later (recommended for first full deploy)

Web waits for `cc-core`, `platform-service`, and `nlp` to start. Build backends first for faster feedback:

```bash
# 1) Infra + all backends (no web)
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build \
  redis kafka cc-core platform-service chat-service call-service social-service nlp

# 2) Web when backends are healthy
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build web
```

### Host dev instead of Docker web (fastest for frontend work)

```bash
npm run docker:up          # redis + kafka
npm run dev                # all backends on host with hot reload
npm run dev:web            # frontend only on host → http://localhost:5173
```

### Check status and logs

```bash
docker compose -f docker/docker-compose.qa.yml ps
docker compose -f docker/docker-compose.qa.yml logs web --tail 50
docker compose -f docker/docker-compose.qa.yml logs cc-core --tail 50
```

### Service names (for compose commands)

| Compose service name | Container name |
|---------------------|----------------|
| `web` | `worktual-web` |
| `cc-core` | `worktual-cc-core` |
| `platform-service` | `worktual-platform-service` |
| `chat-service` | `worktual-chat-service` |
| `call-service` | `worktual-call-service` |
| `social-service` | `worktual-social-service` |
| `nlp` | `worktual-nlp` |
| `redis` | `worktual-redis` |
| `kafka` | `worktual-kafka` |

---

## QA server

Server: `nlp-contactcentre` · App path: `/opt/worktual-ccaas`

UI: https://rebuild-ccaas.worktual.com  
API: https://rebuild-ccaas-api.worktual.com

DevOps owns Nginx, DNS, and TLS — see [devops-routing-spec.md](./devops-routing-spec.md).

### First-time setup

Follow [server-install.md](./server-install.md) for OS packages, Docker, Node, clone, and database schema.

### Every deploy

**1. SSH to the server**
```bash
ssh root@nlp-contactcentre
cd /opt/worktual-ccaas
```

**2. Pull latest code**
```bash
git pull origin main
```

**3. Confirm root `.env` uses QA values**
```env
CORS_ORIGINS=https://rebuild-ccaas.worktual.com
VITE_CC_CORE_URL=https://rebuild-ccaas-api.worktual.com
VITE_PLATFORM_SERVICE_URL=https://rebuild-ccaas-api.worktual.com
VITE_NLP_SERVICE_URL=https://rebuild-ccaas-api.worktual.com
VITE_SOCKET_URL=https://rebuild-ccaas-api.worktual.com
VITE_CALL_SERVICE_URL=https://rebuild-ccaas-api.worktual.com/call-api
CALL_SERVICE_API_V1_PUBLIC_BASE=/call-api/v1
```

**4. Build and start full stack**
```bash
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build
```

**5. Verify containers**
```bash
docker compose -f docker/docker-compose.qa.yml ps
```

**6. Health checks (on server)**
```bash
curl -f http://127.0.0.1:3000/health
curl -f http://127.0.0.1:8000/health
```

**7. Health checks (after DevOps Nginx is live)**
```bash
curl -f https://rebuild-ccaas-api.worktual.com/health
curl -f https://rebuild-ccaas.worktual.com
```

### Rebuild one service (QA)

After a code change, rebuild only what changed:

```bash
# Frontend only
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build web

# One backend only
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build cc-core
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build chat-service
```

See [Build one service only](#build-one-service-only) for the full list.

### Stop QA stack

```bash
docker compose -f docker/docker-compose.qa.yml down
```

---

## Services & ports

| Service | Port | Description |
|---------|------|-------------|
| web | 5173 | React UI (Docker nginx) |
| cc-core | 3000 | Conversations, queues, Socket.IO |
| platform-service | 3001 | Org, users, teams |
| chat-service | 3002 | Webchat, email |
| call-service | 3003 | Voice |
| social-service | 3004 | WhatsApp, social |
| nlp | 8000 | LLM / NLP API |
| redis | 6379 | Cache (Docker internal on QA stack) |
| kafka | 9092 | Events (Docker internal on QA stack) |

---

## Troubleshooting

**Full build takes a long time / web not done yet** — web is the slowest image. Start backends first, then build web alone (see [Build one service only](#build-one-service-only)). Or use `npm run dev:web` on the host for faster frontend iteration.

**Port already in use** — stop old dev servers or containers before starting:
```bash
docker compose -f docker/docker-compose.qa.yml down
# kill local npm run dev processes if needed
```

**Web container not running** — check logs and rebuild:
```bash
docker compose -f docker/docker-compose.qa.yml ps
docker compose -f docker/docker-compose.qa.yml logs web --tail 50
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build web
```

**Web shows API errors** — `VITE_*` must match where the browser can reach APIs. Local = `localhost`; QA = `rebuild-ccaas-api.worktual.com`.

**CORS errors** — `CORS_ORIGINS` must include the UI origin (`http://localhost:5173` locally, `https://rebuild-ccaas.worktual.com` on QA).

**Web image stale after env change** — rebuild web only:
```bash
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build web
```

**Web Docker build fails: `Cannot find module @rollup/rollup-linux-x64-*`** — usually caused by host `node_modules` (macOS) being copied into the image. The repo `.dockerignore` excludes `node_modules`; `Dockerfile.web` runs a fresh `npm ci` on Linux. Rebuild with no cache:
```bash
docker compose -f docker/docker-compose.qa.yml --env-file .env build --no-cache web
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d web
```

**Backend Docker build fails: `prisma: not found` (exit 127)** — `Dockerfile.node` uses `npx prisma generate` directly. Pull latest and rebuild:
```bash
git pull origin main
docker compose -f docker/docker-compose.qa.yml --env-file .env build --no-cache cc-core platform-service chat-service call-service social-service
```

**Node backends restart loop (`Restarting (0)`)** — check logs, then pull latest and rebuild (needs `packages/` in image + `tsx` runner + `turbo build` for deps):
```bash
docker compose -f docker/docker-compose.qa.yml logs cc-core --tail 50
git pull origin main
docker compose -f docker/docker-compose.qa.yml --env-file .env build --no-cache cc-core platform-service chat-service call-service social-service
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d
```

**NLP crash: `IndexError` on `REPOSITORY_ROOT`** — fixed in `settings.py` for Docker `/app` layout. Rebuild nlp:
```bash
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build nlp
```
