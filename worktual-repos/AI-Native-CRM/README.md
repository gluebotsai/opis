# Worktual CRM

Enterprise CRM. **Stack:** Vite SPA (`frontend/`) + Fastify API (`backend/`).

## Develop

```bash
# terminal 1 — API (:4000)
npm run dev:api

# terminal 2 — Web (:5173)
npm run dev:web
```

Open **http://localhost:5173**. See [docs/split-stack-dev.md](./docs/split-stack-dev.md).

## Database

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

## Layout

| Path | Role |
|------|------|
| `frontend/` | Vite + React UI |
| `backend/` | Fastify API (routes, DAO, services) |
| `backend/src/dao/` | DB access (Prisma queries, repositories, stores) |
| `backend/src/service/` | Business / command layer |
| `backend/src/modules/` | HTTP route modules |
| `backend/src/config/` | Module / RBAC matrix |
| `prisma/` | Schema & migrations |
| `ai-service/` | Python agents |
| `campaign-ms/` | Marketing microservice |
