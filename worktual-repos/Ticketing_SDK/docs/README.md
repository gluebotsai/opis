# Worktual — CRM & Ticketing Console

Worktual is a helpdesk ticketing console built with **TypeScript, React, Tailwind CSS, Express, and PostgreSQL**. The API persists to a multi-tenant Postgres schema (`organisation_id` on every business table), with cookie JWT auth, roles, SLA automation, file uploads, persisted notes, and live analytics.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Set DATABASE_URL, JWT_SECRET, and COWORKER_AGENTS_URL (Python LLM on :8012)

# 3. Apply SQL (first time) against the database in DATABASE_URL
psql "$DATABASE_URL" -f sql/001_create_schema.sql
psql "$DATABASE_URL" -f sql/002_seed_data.sql
psql "$DATABASE_URL" -f sql/003_enhancements.sql

# 4. Start the app (split stack — matches DevOps DNS)
npm run dev:api        # :3001
npm run dev:frontend   # :5173
npm run dev:agents     # :8012
```

Open **http://127.0.0.1:5173** and sign in:

| Field | Value |
|-------|--------|
| Email | `jane.smith@worktual.com` |
| Password | `Worktual@123` |

| Script | Purpose |
|--------|---------|
| `npm run dev` | Development server (Express + Vite) |
| `npm run build` | Production build → `dist/` |
| `npm start` | Run production server |
| `npm run lint` | TypeScript check |
| `npm run test:smoke` | DB + authenticated API smoke tests |

---

## Features

1. **Login / roles** — JWT cookie auth; `admin` / `agent` / `viewer` enforced on mutating APIs (queue create is admin-only; viewers are read-only).
2. **Postgres-backed API** — Tickets, customers, KB, queues, activities, metrics, notes scoped by `organisation_id`.
3. **SLA engine** — `due_at` by priority (urgent 4h → low 72h); auto-`Overdue`; queues marked **At Risk** when they have overdue tickets.
4. **Ticket notes** — Persisted to `ticket_notes` (GET/POST `/api/tickets/:id/notes`).
5. **File uploads** — `POST /api/uploads` (multer → `uploads/`); attachment URLs stored on tickets.
6. **Live analytics** — `GET /api/analytics?range=7days|30days|24hours` from SQL aggregates.
7. **Agent console UI** — Dashboard, assigned/team/search queues, Teams, KB, customers, create ticket, settings.
8. **Python co-worker agents** — Chat specialists + triage-assign engine; see [agents.md](./agents.md).

---

## Docs

| Doc | Purpose |
|-----|---------|
| [ticketing-system-modules-and-tasks.md](./ticketing-system-modules-and-tasks.md) | **Modules & tasks map** — what’s built across UI, API, AI |
| [testing-layers.md](./testing-layers.md) | Testing layers 1–9 (WM, auth boundary, regression, …) |
| [product-overview.md](./product-overview.md) | Roles, portals, coworker, lifecycle |
| [architecture-freeze.md](./architecture-freeze.md) | Frozen LangGraph ownership rules |
| [TICKETING_SPOKE_ARCHITECTURE.md](./TICKETING_SPOKE_ARCHITECTURE.md) | **Spoke topology**, runnables, API freeze |
| [TICKETING_AUTH_HANDOFF.md](./TICKETING_AUTH_HANDOFF.md) | Four auth surfaces + CRM JWT |
| [CRM_TICKETING_HANDOFF.md](./CRM_TICKETING_HANDOFF.md) | CRM iframe module integration |
| [CCAAS_TICKETING_HANDOFF.md](./CCAAS_TICKETING_HANDOFF.md) | CCaaS intake + embed integration |
| [TICKETING_PRODUCTION_CHECKLIST.md](./TICKETING_PRODUCTION_CHECKLIST.md) | Production deploy checklist |
| [agent-catalog.md](./agent-catalog.md) | **All agents** — Super / Domain / Executor / proactive, tasks, brief descriptions |
| [agents.md](./agents.md) | How agents are built: stack, workflows, query → reply |
| [agents-working-guide.md](./agents-working-guide.md) | **Simple guide** — proactive / semi-active / autonomous agents |
| [agents-ticket-lifecycle.md](./agents-ticket-lifecycle.md) | **E2E lifecycle** — create → resolve; autonomous vs semi-autonomous |
| [proactive-agents.md](./proactive-agents.md) | Proactive agents: scenarios and Approvals behaviour |
| [ticketing_flow.md](./ticketing_flow.md) | Target ticket lifecycle design |
| [global-ticketing-model.md](./global-ticketing-model.md) | Data / tenancy model notes |
| [ticketing-tables-and-labels.md](./ticketing-tables-and-labels.md) | Tables + columns + all status/priority/channel labels |
| [ticketing-table-catalog.md](./ticketing-table-catalog.md) | Full catalog: purpose, columns, categoricals, samples; hub/CDP read columns |
| [ticketing-storage.md](./ticketing-storage.md) | Customer + ticket storage (CDP person, `contact_profile`, `tickets`, notes, orders) |
| [ticketing-schema.md](./ticketing-schema.md) | Full schema reference (incl. MyAccount tables) |
| [ticketing-hub-spoke-ownership.md](./ticketing-hub-spoke-ownership.md) | Hub/spoke SoR: CDP person/orders, inventory products, ticketing ops |
| [ticketing-accounts-agent-scope.md](./ticketing-accounts-agent-scope.md) | MyAccount ↔ agents.id mapping + ticket count/list scopes by role |
| [ticketing-sql-agent-guide.md](./ticketing-sql-agent-guide.md) | SQL agent: purposes, schema map, joins, scopes, metrics cheat sheet |
| [ticketing-synthetic-data-spec.md](./ticketing-synthetic-data-spec.md) | 3-year synthetic data: full column schema, volumes, scenarios |
| [ticketing-customer-metrics.md](./ticketing-customer-metrics.md) | Customer-grain metrics — keep/drop catalog + formulas |
| [ticketing-metric-catalog-calculations.md](./ticketing-metric-catalog-calculations.md) | How to calculate all 94 catalog metrics (SQL + formulas) |

---

## Project structure

```
Ticketing_Rebuild/
├── docs/README.md
├── docs/agents.md            # Co-worker agents: stack, flows, query → reply
├── server.ts                 # Express API (Postgres + auth)
├── ai-agents/          # Python FastAPI / LangGraph agents
├── src/
│   ├── App.tsx               # Auth gate + view routing
│   ├── server/               # db, mappers, sla helpers
│   ├── components/           # UI including LoginView
│   └── types.ts
├── sql/
│   ├── 001_create_schema.sql
│   ├── 002_seed_data.sql
│   └── 003_enhancements.sql  # password_hash, due_at
├── scripts/smoke-test.mjs
└── uploads/                  # Local attachment storage
```

---

## PostgreSQL

| Setting | Value |
|---------|--------|
| Connection | `DATABASE_URL` in the repo-root `.env` |

Tables: `organisations`, `users` (+ `password_hash`), `customers`, `agent_queues`, `tickets` (+ `due_at`, `first_response_at`), `ticket_notes`, `kb_articles`, `activity_logs`, `notifications`, `dashboard_metrics`.

---

## API (authenticated unless noted)

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/auth/login` | Sets httpOnly cookie |
| `POST` | `/api/auth/logout` | |
| `GET` | `/api/auth/me` | |
| `GET` | `/api/health` | Public; reports DB |
| `GET/POST` | `/api/tickets` | Agent/admin mutate |
| `PUT` | `/api/tickets/:id` | |
| `GET/POST` | `/api/tickets/:id/notes` | |
| `POST` | `/api/uploads` | multipart files |
| `GET/POST` | `/api/customers`, `/api/kb` | |
| `GET/POST` | `/api/queues` | POST = admin only |
| `GET` | `/api/activities`, `/api/metrics`, `/api/analytics`, `/api/agents` | |
| `POST` | `/api/ai-insights` | Gemini or fallback |
| `GET` | `/api/webchat/tickets/docs` | Browsable webchat API docs (no auth) |
| `POST` | `/api/webchat/tickets` | Webchat create (org API key) |
| `POST` | `/api/webchat/tickets/lookup` | Webchat: one ticket status by id+email, or last 5 by email (org API key) |
| `POST` | `/api/webchat/articles/search` | Webchat: is this query related to a published article (org API key) |
| `POST` | `/api/webchat/customers/verify` | Webchat verify Ticketing + customer exists (org API key) |

---

## Webchat integration APIs

Server-to-server APIs for the webchat / CCaaS team. They **POST JSON** from their backend (not a browser page).

**Browsable docs (open in a browser):** [http://192.168.13.42:3000/api/webchat/tickets/docs](http://192.168.13.42:3000/api/webchat/tickets/docs)

| | |
|--|--|
| **Base URL** | `http://192.168.13.42:3000` |
| **Auth** | `Authorization: Bearer wt_live_…` **or** `X-Api-Key: wt_live_…` |
| **Content-Type** | `application/json` |
| **Rule** | Customer must already exist (match by email or mobile). We do **not** auto-create customers. |

Replace host/port in production if DNS differs. Create org API keys in Ticketing → Org preferences → integration keys.

---

### 1. Create ticket

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `http://192.168.13.42:3000/api/webchat/tickets` |

**Request headers**

```
Authorization: Bearer wt_live_YOUR_KEY
Content-Type: application/json
```

**Request payload (email)**

```json
{
  "name": "Riya Sharma",
  "email": "riya@clienta.com",
  "issue": "VPN not connecting since morning"
}
```

**Request payload (mobile instead of email)**

```json
{
  "name": "Riya Sharma",
  "mobile": "+919876543210",
  "issue": "Unable to reset password"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `name` | yes | Requester display name |
| `email` **or** `mobile` / `phone` | yes (one of) | Must match an existing customer |
| `issue` | yes | Becomes subject + description; ticket channel = `Chat` |

**Sample success output — `201`**

```json
{
  "success": true,
  "ticketId": "184291038472",
  "ticketNumber": "#12899",
  "status": "Open",
  "channel": "Chat",
  "subject": "VPN not connecting since morning",
  "assignee": "Unassigned",
  "assigneeId": null,
  "resolver": null,
  "resolverId": null,
  "createdAt": "2026-08-24T16:30:00.000Z",
  "updatedAt": "2026-08-24T16:30:00.000Z"
}
```

**Sample failure — customer not found — `404`**

```json
{
  "success": false,
  "error": "there is no account for this customer"
}
```

**Sample failure — missing fields — `400`**

```json
{
  "success": false,
  "error": "email or mobile number is required"
}
```

**curl example**

```bash
curl -X POST http://192.168.13.42:3000/api/webchat/tickets \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Riya Sharma",
    "email": "riya@clienta.com",
    "issue": "VPN not connecting since morning"
  }'
```

---

### 2. Fetch / lookup tickets

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `http://192.168.13.42:3000/api/webchat/tickets/lookup` |

**Request headers**

```
Authorization: Bearer wt_live_YOUR_KEY
Content-Type: application/json
```

**Request payload**

```json
{ "email": "riya@clienta.com" }
```

or one ticket:

```json
{ "email": "riya@clienta.com", "ticketId": "#20006" }
```

| Field | Required | Notes |
|-------|----------|--------|
| `email` | yes when listing, or with `ticketId` | Must match the ticket / customer |
| `ticketId` / `ticketNumber` | no | If set, return only that ticket’s `status` |
| `mobile` / `phone` | no | Still allowed for the recent-5 list if no ticket id |

**Sample success output — `200`**

```json
{
  "success": true,
  "customer": {
    "id": "1001",
    "name": "Riya Sharma",
    "email": "riya@clienta.com",
    "phone": "+919876543210"
  },
  "tickets": [
    {
      "id": "#12899",
      "subject": "VPN not connecting since morning",
      "description": "VPN not connecting since morning",
      "customerName": "Riya Sharma",
      "customerEmail": "riya@clienta.com",
      "customerPhone": "+919876543210",
      "channel": "Chat",
      "assignee": "Unassigned",
      "status": "Open",
      "priority": "medium",
      "createdAt": "2026-08-24T16:30:00.000Z",
      "updatedAt": "just now"
    }
  ]
}
```

**Sample failure — customer not found — `404`**

```json
{
  "success": false,
  "error": "there is no account for this customer"
}
```

**curl example**

```bash
curl -X POST http://192.168.13.42:3000/api/webchat/tickets/lookup \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"riya@clienta.com"}'
```

---

### 3. Related article (user query)

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `http://192.168.13.42:3000/api/webchat/articles/search` |

**Request headers**

```
Authorization: Bearer wt_live_YOUR_KEY
Content-Type: application/json
```

**Request payload**

```json
{ "query": "VPN not connecting" }
```

| Field | Required | Notes |
|-------|----------|--------|
| `query` (or `q`) | yes | The user’s message. Searches published KB only. No customer required. |

**Sample success — related — `200`**

```json
{
  "success": true,
  "query": "VPN not connecting",
  "related": true,
  "article": {
    "articleId": "KB-1001",
    "title": "Reset VPN client",
    "symptoms": ["offline", "cannot connect"],
    "steps": ["Open the client", "Reconnect"],
    "text": "Open the client. Reconnect.",
    "score": 0.91
  }
}
```

**Sample success — not related — `200`**

```json
{
  "success": true,
  "query": "what is the cafeteria menu",
  "related": false,
  "article": null
}
```

**Sample failure — missing query — `400`**

```json
{
  "success": false,
  "error": "query is required"
}
```

**curl example**

```bash
curl -X POST http://192.168.13.42:3000/api/webchat/articles/search \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"VPN not connecting"}'
```

---

### 4. Verify customer (Ticketing entitlement + directory)

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `http://192.168.13.42:3000/api/webchat/customers/verify` |

**Request headers**

```
Authorization: Bearer wt_live_YOUR_KEY
Content-Type: application/json
```

**Request payload**

```json
{ "email": "riya@clienta.com" }
```

or

```json
{ "mobile": "+919876543210" }
```

Optional: `organizationId` — must match the API key tenant if provided.

| Field | Required | Notes |
|-------|----------|--------|
| `email` **or** `mobile` / `phone` | yes (one of) | Must match an existing **Active** customer |
| `organizationId` | no | Inferred from API key; body value must match |

**Checks performed**

1. Organization has **Ticketing** product in MyAccount (`product_id = 'ticketing'`)
2. Customer exists in CDP + Ticketing directory for that org (Active)

**Sample success — `200`**

```json
{
  "success": true,
  "organizationId": "1000",
  "customer": {
    "id": "1001",
    "name": "Riya Sharma",
    "email": "riya@clienta.com",
    "phone": "+919876543210"
  }
}
```

**Sample failure — customer not found — `404`**

```json
{
  "success": false,
  "error": "there is no account for this customer",
  "code": "customer_not_found"
}
```

**Sample failure — org has no Ticketing — `403`**

```json
{
  "success": false,
  "error": "This organization has not purchased Ticketing.",
  "code": "ticketing_not_purchased"
}
```

**Sample failure — inactive customer — `403`**

```json
{
  "success": false,
  "error": "This customer account is inactive. Contact support if you need access.",
  "code": "customer_inactive"
}
```

**curl example**

```bash
curl -X POST http://192.168.13.42:3000/api/webchat/customers/verify \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"riya@clienta.com"}'
```

---

See also [intake-api.md](./intake-api.md) for the general multi-channel intake API.

---

## Testing

```bash
npm run test:smoke   # requires npm run dev
npm run lint
npm run build
```
