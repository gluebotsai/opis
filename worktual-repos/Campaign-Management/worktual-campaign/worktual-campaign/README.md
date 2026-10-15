# Worktual Campaign MS — Vite + Fastify

Standalone campaign product split into:

- **frontend/** — React + TypeScript + Vite + Redux Toolkit + React Router + Axios + Socket.IO client + React Hook Form + Recharts
- **backend/** — Node.js + Fastify + TypeScript + PostgreSQL (Prisma) + Redis (optional) + Socket.IO + JWT + Swagger

Uses `my_account_qa` for login/contacts (pg pool) and `campaign_db` for campaign data + agent sessions (Prisma).
Audience stores contact UUID refs only in `campaign_audience_refs`.

## Login credentials

Password for seeded users: **`demo`**

| Email | Role |
|-------|------|
| `marketing.b2b@worktual.com` | marketing |
| `admin.b2b@worktual.com` | admin |
| `manager.b2b@worktual.com` | sales_manager |

Campaign mode follows `accounts.organizations.business_type` on login:
- **B2B** → Generic B2B
- **B2C** → Generic B2C (e.g. Inspire org)

There is no Finance pack or industry dropdown — type comes from the logged-in org.

## Prerequisites

- PostgreSQL with `my_account_qa` and `campaign_db`
- Node 20+
- Redis optional (`REDIS_URL`; falls back to in-memory cache)

## Setup

```bash
cd worktual-campaign   # this folder
cp backend/.env.example backend/.env
npm install
npm run db:deploy --workspace=backend
npm run db:seed --workspace=backend
```

## Run

```bash
# API :3001  +  Vite :5173
npm run dev:backend
npm run dev:frontend
```

- App UI: http://localhost:5173  
- API + Swagger: http://localhost:3001/docs  
- Health: http://localhost:3001/health  

## Docker (production server)

```bash
cp deploy/docker.env.example .env
cp backend/.env.example backend/.env
cp deploy/agents.env.example agents/.env
# edit .env + backend/.env + agents/.env
docker compose build && docker compose up -d
```

Full guide: [deploy/README.md](deploy/README.md)

## Email configuration

- **Microservice architecture (share with other teams):** [docs/CAMPAIGN_MICROSERVICE.md](docs/CAMPAIGN_MICROSERVICE.md)
- Start-to-end operator guide: [docs/EMAIL_CONFIGURATION.md](docs/EMAIL_CONFIGURATION.md) (My Accounts mailbox only).
- OpenDKIM / Postfix handoff (ops): [docs/EMAIL_OPENDKIM_HANDOFF.md](docs/EMAIL_OPENDKIM_HANDOFF.md).

## Database schema

- Campaign DB tables/columns CSV + ER diagram: [docs/schema/](docs/schema/) ([tables](docs/schema/campaign_tables.csv), [columns](docs/schema/campaign_columns.csv), [ER Mermaid](docs/schema/campaign_er_diagram.md), [ER PNG](docs/schema/campaign_er_diagram.png)).

## Structure

```
frontend/src/
  components/  pages/  layouts/  hooks/  services/  store/  routes/  utils/  types/

backend/src/          # Downloads-style Fastify layout
  index.ts / server.ts
  config/
  plugins/            # prisma, account-pool, redis, swagger, socket
  middlewares/        # validateSession, error-handler
  helpers/            # constants, response-builders, tenant
  dao/                # Postgres data access (Prisma / pg)
  modules/            # auth | campaign | contact | template | channel stubs
    */routes.ts + handler.ts (+ schema.ts)
  service/            # future schedulers / provider adapters
```

## CRM link-out

In CRM `.env`:

```bash
MARKETING_MS_URL="http://localhost:5173"
```
