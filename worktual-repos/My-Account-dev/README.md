# Worktual My Accounts

**Knowledge transfer (living):** see [`knowledge.md`](./knowledge.md) for portals, login, DB tables, and action→database maps. Update that file whenever those areas change.

Clean two-package layout:

```text
frontend/   React + Vite UI (TypeScript/TSX; own package.json, .env, node_modules)
backend/    TypeScript Fastify API, workers, database, and infrastructure
```

No shared root dependencies. Install and run each package independently.

## Backend

```bash
cd backend
cp .env.example .env   # if needed
pnpm install
pnpm dev
```

API defaults to http://localhost:3002

All API, mail/OAuth, SSE, and payment webhook routes are owned directly by Fastify.

Useful env flags:

- `ALLOW_LOGIN_SESSION_REPLACE=1` — allow `{ "replaceSession": true }` on login for smoke tests
- `REDIS_URL=redis://127.0.0.1:6379` — optional; without it health reports `redis.configured: false`

## Frontend

```bash
cd frontend
cp .env.example .env   # if needed
pnpm install
pnpm dev
```

`pnpm dev` serves a production-like bundle (few chunks), rebuilds on file changes, and refreshes the browser. UI defaults to http://localhost:5173 and proxies `/api` to the backend.

For Vite HMR while editing UI: `pnpm dev:hmr` (unbundled ESM — many script requests in Network is normal).
