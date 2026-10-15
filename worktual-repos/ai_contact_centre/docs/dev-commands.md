# Local development commands

Quick reference for running, restarting, and tailing logs across omni-channel services.

Run all commands from the **repo root** unless noted.

---

## Service map

| Service | Port | npm script | Omni-channel |
|---------|------|------------|--------------|
| **web** (Agent/Admin UI) | 5173 | `dev:web` | All channels (UI) |
| **cc-core** (routing, offers, workspace API) | 3000 | `dev:cc-core` | All |
| **platform-service** | 3001 | `dev:platform-service` | Config |
| **chat-service** | 3002 | `dev:chat-service` | **Webchat**, **Email** |
| **call-service** | 3003 | `dev:call-service` | Voice |
| **social-service** | 3004 | `dev:social-service` | **WhatsApp**, **Instagram**, **Facebook** |
| **nlp** (bot / intent) | 8000 | `dev:nlp` | All bot channels |

Health checks:

```bash
curl -s http://localhost:5173/ | head -1          # web
curl -s http://localhost:3000/health              # cc-core
curl -s http://localhost:3001/health              # platform-service
curl -s http://localhost:3002/health              # chat-service
curl -s http://localhost:3003/health              # call-service
curl -s http://localhost:3004/health              # social-service
curl -s http://localhost:8000/health              # nlp
```

---

## First-time / infra

```bash
npm install
npm run docker:up              # redis + kafka (default)
npm run docker:up -- --all     # postgres + redis + kafka
npm run db:generate
```

Copy env files — see [deploy/env-files.md](./deploy/env-files.md).

---

## Development mode

### Run everything (Turbo TUI — one terminal)

```bash
npm run dev
```

Starts all apps with hot reload. Stop with `Ctrl+C`.

Optional: infra only in Docker, apps on host:

```bash
npm run docker:up
npm run dev
```

### Run one service (separate terminal — best for channel debugging)

```bash
npm run dev:web
npm run dev:cc-core
npm run dev:platform-service
npm run dev:chat-service
npm run dev:call-service
npm run dev:social-service
npm run dev:nlp
```

### Run with log files (recommended before tailing logs)

From repo root, each service writes under `apps/<service>/logs/`:

```bash
cd apps/cc-core && LOG_FILE=logs/cc-core.log npm run dev
cd apps/chat-service && LOG_FILE=logs/chat-service.log npm run dev
cd apps/social-service && LOG_FILE=logs/social-service.log npm run dev
cd apps/platform-service && LOG_FILE=logs/platform-service.log npm run dev
cd apps/call-service && LOG_FILE=logs/call-service.log npm run dev
cd apps/nlp && npm run dev   # NLP logs to apps/nlp/logs/ by default (LOG_DIR=logs)
```

`chat-service` already sets `LOG_FILE=logs/chat-service.log` in its `package.json` dev script.

---

## Restart all services

### If using `npm run dev` (Turbo)

```bash
# In the Turbo terminal: Ctrl+C, then:
npm run dev
```

### Hard restart (kill all dev ports, then start again)

```bash
for p in 5173 3000 3001 3002 3003 3004 8000; do
  lsof -ti :$p | xargs kill -9 2>/dev/null || true
done

npm run docker:up
npm run dev
```

---

## Restart one service

Kill the port, then start that service again in its own terminal.

```bash
# Helper (add to ~/.zshrc if you like)
kill_port() { lsof -ti :"$1" | xargs kill -9 2>/dev/null || true; }
```

| Service | Kill | Restart |
|---------|------|---------|
| web | `kill_port 5173` | `npm run dev:web` |
| cc-core | `kill_port 3000` | `npm run dev:cc-core` |
| platform-service | `kill_port 3001` | `npm run dev:platform-service` |
| chat-service | `kill_port 3002` | `npm run dev:chat-service` |
| call-service | `kill_port 3003` | `npm run dev:call-service` |
| social-service | `kill_port 3004` | `npm run dev:social-service` |
| nlp | `kill_port 8000` | `npm run dev:nlp` |

**Example — restart cc-core after a routing fix:**

```bash
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
cd apps/cc-core && LOG_FILE=logs/cc-core.log npm run dev
```

> After changing **cc-core** or **offer-lifecycle**, restart **cc-core** only.  
> After changing **whatsapp-orchestrator** or webhooks, restart **social-service** only.

---

## Kill one service (leave others running)

```bash
# Replace PORT with 3000, 3002, 3004, etc.
lsof -ti :3002 | xargs kill -9
```

Or by process name (broader — use with care):

```bash
pkill -f "tsx watch src/index.ts"   # kills all tsx watch services
```

Prefer **kill by port** so you do not stop unrelated services.

---

## ngrok (webhooks: webchat public URL, WhatsApp, Instagram, Facebook)

Config: [`ngrok.yml`](../ngrok.yml) — single **gateway** tunnel on **8080** (local reverse proxy).

The proxy routes **chat-service (3002)** and **social-service (3004)** through one public URL:

| Public path | Backend |
|-------------|---------|
| `/ws/webchat`, `/chat-api/*`, default | `:3002` chat-service |
| `/social-api/*`, `/webhooks/*`, `/internal/v1/{whatsapp,facebook,instagram}/*` | `:3004` social-service |

Public URL: `https://uninvited-skinless-eel.ngrok-free.dev` (see [`ngrok.yml`](../ngrok.yml); override with `NGROK_DOMAIN`)

Meta webhook examples:

- `https://uninvited-skinless-eel.ngrok-free.dev/social-api/webhooks/whatsapp`
- `https://uninvited-skinless-eel.ngrok-free.dev/social-api/webhooks/facebook`
- `https://uninvited-skinless-eel.ngrok-free.dev/social-api/webhooks/instagram`

### Start gateway proxy + ngrok

Ensure **chat-service (:3002)** and **social-service (:3004)** are running first, then:

```bash
npm run dev:gateway-proxy   # terminal 1 — proxy :8080 → :3002 / :3004
npm run ngrok:gateway       # terminal 2 — public HTTPS URL
```

Or run ngrok in the foreground (keeps running until Ctrl+C):

```bash
ngrok http --domain=uninvited-skinless-eel.ngrok-free.dev --pooling-enabled 8080
```

Dashboard: http://localhost:4040

### Restart ngrok

```bash
pkill -f ngrok || true
npm run dev:gateway-proxy &
npm run ngrok:gateway
```

### Legacy: separate tunnels (not recommended)

```bash
npm run ngrok:chat      # chat-service → port 3002 only
npm run ngrok:social    # social-service → port 3004 only
```

### Kill ngrok only

```bash
pkill -f ngrok
```

Update Meta / webhook URLs when the ngrok hostname changes (tunnel restarts get a new URL on free tier).

---

## Live logs — omni-channel

### All channel-related services (one command)

Ensure services were started with `LOG_FILE` (see above), then:

```bash
tail -F \
  apps/cc-core/logs/cc-core.log \
  apps/chat-service/logs/chat-service.log \
  apps/social-service/logs/social-service.log \
  apps/nlp/logs/*.log \
  2>/dev/null
```

If a log file does not exist yet, start that service once with `LOG_FILE=...`.

### By channel

**Webchat** (WS + handoff):

```bash
tail -F apps/chat-service/logs/chat-service.log | rg -i "webchat|handoff|ws"
```

**Email** (Gmail ingest + routing):

```bash
tail -F apps/chat-service/logs/chat-service.log | rg -i "email|gmail|live_agent_handoff|email-process"
```

**WhatsApp / Instagram / Facebook**:

```bash
tail -F apps/social-service/logs/social-service.log | rg -i "whatsapp|instagram|facebook|handoff|busy|webhook"
```

**Routing, offers, timeout, reject** (all channels):

```bash
tail -F apps/cc-core/logs/cc-core.log | rg -i "routing|offer|timeout|reject|expire|whatsapp|webchat"
```

**NLP bot turns**:

```bash
tail -F apps/nlp/logs/*.log | rg -i "webchat|whatsapp|intent|handoff"
```

**Agent UI** — browser DevTools Network/WS; no server log file for Vite unless you add one.

### cc-core: offer-timeout delivery

```bash
tail -F apps/cc-core/logs/cc-core.log | rg -i "Offer-timeout fallback|offer expiration|conversation offer expiration"
```

### Docker infra logs

```bash
docker compose -f docker/docker-compose.yml logs -f redis kafka
docker compose -f docker/docker-compose.yml logs -f postgres   # if using --all
```

---

## Useful extras

```bash
# Typecheck everything
npm run check-types

# E2E webchat (single / two agent)
cd apps/web && npm run test:e2e:webchat-single-agent
cd apps/web && npm run test:e2e:webchat-two-agent

# Reset webchat test state + offer timeout (20s)
npx tsx apps/cc-core/scripts/cleanup-worktual1-webchat.ts --live
npx tsx apps/cc-core/scripts/set-offer-timeout.ts --seconds 20 --live

# Ensure two test agents on webchat queue
npx tsx apps/cc-core/scripts/ensure-webchat-two-agents.ts --live
```

Test agents (default):

| Agent | Email | Password |
|-------|-------|----------|
| A | `agent.test@worktual.local` | `Worktual@123` |
| B | `agent2.test@worktual.local` | `Worktual@123` |

UI: http://localhost:5173/login

---

## Troubleshooting

| Problem | Try |
|---------|-----|
| Port already in use | `lsof -i :3000` then kill PID, or use **Kill one service** above |
| WhatsApp webhook 404 | Restart `social-service` + ngrok; URL must hit port **3004** |
| Webchat WS fails | Restart `chat-service` + ngrok on port **3002** |
| Offer timeout not firing | Restart **cc-core**; check `set-offer-timeout.ts --live` |
| No busy message on WhatsApp after timeout | Restart **cc-core** (delivery fix in `offer-lifecycle.ts`) + **social-service** |
| DB connection errors | `npm run docker:up -- --all` and check `DATABASE_URL` in root `.env` |

See also [deploy/build.md](./deploy/build.md) for Docker QA deploy commands.
