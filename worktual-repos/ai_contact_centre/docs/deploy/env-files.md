# Environment files

Two env files only (both gitignored):

| File | Purpose |
|------|---------|
| **`.env`** (repo root) | All backend services, Prisma, Docker QA |
| **`apps/web/.env`** | Frontend `VITE_*` URLs |

Template for frontend only: [`apps/web/.env.example`](../../apps/web/.env.example)

## Backend `.env` (repo root)

Loaded by [`packages/config/load-root-env.js`](../../packages/config/load-root-env.js) and NLP [`settings.py`](../../apps/nlp/src/app/config/settings.py).

**Required for local dev:**
- `DATABASE_URL` — ccass schema
- `PLATFORM_DATABASE_URL` — platform schema
- `JWT_SECRET`
- `TOGETHER_API_KEY`
- `CORS_ORIGINS=http://localhost:5173`

**Service URLs** (local defaults):
- `CC_CORE_URL`, `PLATFORM_SERVICE_URL`, `CHAT_SERVICE_URL`, etc. → `http://localhost:300x`

**Optional:** Gmail (`GMAIL_*`, `MS_TOKEN_ENCRYPTION_KEY`), WhatsApp (`META_*`), `CHAT_OPENAI_*`

**A2A spoke** (`apps/a2a-server`, port 8020) — see [a2a-spoke.md](./a2a-spoke.md):
- `A2A_ENABLED=false` (master switch)
- `A2A_PUBLIC_URL`, `A2A_OAUTH_ISSUER`, `A2A_OAUTH_JWKS_URL`, `A2A_OAUTH_AUDIENCE`, `A2A_OAUTH_TOKEN_URL`
- `A2A_ENABLED_TENANTS`, `A2A_ENABLED_SKILLS` for staged rollout
- Outbound Hub remote agent: `HUB_A2A_URL`, `HUB_A2A_TOKEN_URL`, `HUB_A2A_CLIENT_ID` (`worktual-ccaas-hub`), `HUB_A2A_CLIENT_SECRET`

## Frontend `apps/web/.env`

```env
VITE_CC_CORE_URL=http://localhost:3000
VITE_PLATFORM_SERVICE_URL=http://localhost:3001
VITE_NLP_SERVICE_URL=http://localhost:8000
VITE_SOCKET_URL=http://localhost:3000
VITE_CALL_SERVICE_URL=http://localhost:3003
```

## QA server

Use the same two files on `nlp-contactcentre`:
- `.env` — set `CORS_ORIGINS` and `VITE_*` to QA URLs (see [build.md](./build.md))
- `apps/web/.env` — only needed for host-side `npm run dev:web`; Docker web image reads `VITE_*` from root `.env` at build time

Full deploy steps: [build.md](./build.md#qa-server)
