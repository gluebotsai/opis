# DevOps Nginx Routing Spec — Worktual CCaaS QA

Hand this document to your DevOps team. They configure Nginx, DNS, and TLS. The app team runs Docker on `nlp-contactcentre` as **root**.

## Server

| Field | Value |
|-------|-------|
| **Hostname** | `nlp-contactcentre` |
| **Server IP** | `<SERVER_PUBLIC_IP>` |
| **Deploy path** | `/opt/worktual-ccaas` |
| **Deploy user** | `root` |

## URLs

| Host | Purpose |
|------|---------|
| `https://rebuild-ccaas.worktual.com` | QA web UI (static files) |
| `https://rebuild-ccaas-api.worktual.com` | QA API gateway |

## UI host — `rebuild-ccaas.worktual.com`

- **Root:** `/opt/worktual-ccaas/apps/web/dist`
- **SPA fallback:** `try_files $uri /index.html`
- **Cache:** long cache for hashed assets; no cache for `index.html`

## API host — `rebuild-ccaas-api.worktual.com`

Services expose **unique public prefixes** natively (dual-mounted with `/api/v1` for Docker-internal traffic). Nginx uses **pass-through** routing (no path rewrite).

| Public path prefix | Upstream | Notes |
|--------------------|----------|-------|
| `/cc-core-api/` | `127.0.0.1:3000` | cc-core REST + optional `/cc-core-api/socket.io` |
| `/platform-api/` | `127.0.0.1:3001` | platform-service |
| `/nlp-api/` | `127.0.0.1:8000` | nlp — disable proxy buffering on `*/copilot/stream` |
| `/a2a/` | `127.0.0.1:8020` | Contact Centre A2A spoke — Agent Card + JSON-RPC |
| `/social-api/` | `127.0.0.1:3004` | social-service — WhatsApp webhooks |
| `/chat-api/` | `127.0.0.1:3002` | chat-service — WebSocket at `/chat-api/ws/webchat` |
| `/call-api/` | `127.0.0.1:3003` | call-service — SIP session for the workspace UA |
| `/health` | `127.0.0.1:3000` | cc-core health check |

### Example public URLs

| Endpoint | URL |
|----------|-----|
| Login | `https://rebuild-ccaas-api.worktual.com/cc-core-api/v1/auth/login` |
| Users | `https://rebuild-ccaas-api.worktual.com/platform-api/v1/users` |
| Copilot SSE | `https://rebuild-ccaas-api.worktual.com/nlp-api/v1/copilot/stream` |
| A2A Agent Card | `https://rebuild-ccaas-api.worktual.com/a2a/.well-known/agent-card.json` |
| WhatsApp webhook | `https://rebuild-ccaas-api.worktual.com/social-api/webhooks/whatsapp` |
| Agent socket | `wss://rebuild-ccaas-api.worktual.com/cc-core-api/socket.io` |
| Webchat WS | `wss://rebuild-ccaas-api.worktual.com/chat-api/ws/webchat` |
| SIP session | `https://rebuild-ccaas-api.worktual.com/call-api/v1/sip/session` |

## Nginx requirements

- [ ] DNS A records for both subdomains → server IP
- [ ] TLS certificates on both hosts
- [ ] WebSocket headers on socket.io and chat-api paths:
  - `proxy_http_version 1.1`
  - `proxy_set_header Upgrade $http_upgrade`
  - `proxy_set_header Connection "upgrade"`
- [ ] SSE on `/nlp-api/v1/copilot/stream` (and related stream paths):
  - `proxy_buffering off`
  - `proxy_read_timeout 3600s` (or similar)
- [ ] CORS origin `https://rebuild-ccaas.worktual.com` is allowed by app config

## Example Nginx snippets (reference only)

```nginx
# UI
server {
    listen 443 ssl;
    server_name rebuild-ccaas.worktual.com;
    root /opt/worktual-ccaas/apps/web/dist;
    index index.html;
    location / {
        try_files $uri /index.html;
    }
}

# API — pass-through by service prefix
location /cc-core-api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

location /platform-api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
}

location /nlp-api/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_set_header Host $host;
}

location /social-api/ {
    proxy_pass http://127.0.0.1:3004;
    proxy_set_header Host $host;
}

location /chat-api/ {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}

location /call-api/ {
    proxy_pass http://127.0.0.1:3003;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
}
```

## Backend env vars (set in root `.env` on QA server)

| Service | Variable | QA value |
|---------|----------|----------|
| cc-core | `CC_CORE_API_V1_PUBLIC_BASE` | `/cc-core-api/v1` |
| cc-core | `PUBLIC_APP_URL` | `https://rebuild-ccaas.worktual.com` |
| cc-core | `SOCKET_IO_PATH` | `/cc-core-api/socket.io` |
| platform | `PLATFORM_API_V1_PUBLIC_BASE` | `/platform-api/v1` |
| nlp | `NLP_API_V1_PUBLIC_BASE` | `/nlp-api/v1` |
| social | `WEBHOOK_PUBLIC_PREFIX` | `/social-api` (webhooks **and** `/social-api/internal/v1/{whatsapp,facebook,instagram}/*`) |
| chat | `WEBCHAT_WS_PATHS` | `/ws/webchat,/ccaas/chat,/chat-api/ws/webchat` |
| call | `CALL_SERVICE_API_V1_PUBLIC_BASE` | `/call-api/v1` |

## Frontend env vars (root `.env`, baked into web at build)

```env
VITE_CC_CORE_URL=https://rebuild-ccaas-api.worktual.com/cc-core-api
VITE_PLATFORM_SERVICE_URL=https://rebuild-ccaas-api.worktual.com/platform-api
VITE_NLP_SERVICE_URL=https://rebuild-ccaas-api.worktual.com/nlp-api
VITE_CALL_SERVICE_URL=https://rebuild-ccaas-api.worktual.com/call-api
VITE_API_V1_PREFIX=/v1
VITE_SOCKET_URL=https://rebuild-ccaas-api.worktual.com
VITE_SOCKET_PATH=/cc-core-api/socket.io
```

Rebuild web after changing `VITE_*`: `docker compose -f docker/docker-compose.qa.yml build --no-cache web`

## Contacts

- **App team:** runs Docker Compose, builds web, manages `.env` and `apps/web/.env`
- **DevOps:** Nginx, DNS, TLS, firewall 80/443
