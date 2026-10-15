# Worktual Ticketing — Product Overview

Complete guide to what this product is, who logs in, what each module does, and how the pieces fit together.

Related docs: [database-tables.md](./database-tables.md) · [agents.md](./agents.md) · [intake-api.md](./intake-api.md) · [INTEGRATIONS_README.md](./INTEGRATIONS_README.md)

---

## 1. What is Worktual Ticketing?

**Worktual** is a multi-tenant **helpdesk / CRM ticketing console**. Each company (organization) gets an isolated workspace. Staff work tickets; customers open and track their own cases; external channels (web widget, email, API) create tickets into the same system.

**Stack**

| Layer | Tech |
|-------|------|
| UI | React + TypeScript + Tailwind (Vite) |
| API | Express (`ui-backend`) |
| Database | PostgreSQL — schema `ticketing` |
| Skills / assignment data | Separate DB `ticketing_skills` |
| AI co-worker + triage | Python FastAPI (`ai-agents`, port **8012**) |
| Auth | Email/password → JWT in httpOnly cookie |

**Default local URL:** `http://localhost:3000`

---

## 2. Logins & authentication

### How login works

1. User opens the app → **Login** screen (`LoginView`).
2. `POST /api/auth/login` with email + password.
3. Before password check, the app may **sync the user from MyAccount** (`accounts` schema) so the same UUID and bcrypt hash work after onboarding emails.
4. On success:
   - Creates a row in `user_sessions` (device, browser, OS, IP).
   - Logs a row in `user_login_events`.
   - Sets `users.last_login_at`.
   - Issues a **JWT** in an httpOnly cookie.
5. `GET /api/auth/me` restores the session on refresh.
6. `POST /api/auth/logout` revokes the current session and clears the cookie.

### Demo / smoke login (local only)

Only when `SEED_DEMO=1` is set:

| Field | Value |
|-------|--------|
| Email | `jane.smith@worktual.com` |
| Password | value of `SEED_DEMO_PASSWORD` (e.g. `Worktual@123`) |
| Role | `admin` |

**Production:** users are onboarded via **MyAccount**; credentials are mailed there. Ticketing mirrors those users (same IDs + password hashes) and does not invent production accounts.

### Other “logins” / entry points (not the staff login screen)

| Entry | Auth | Purpose |
|-------|------|---------|
| Staff / customer portal | Email + password (JWT cookie) | Main app |
| Intake API | `Authorization: Bearer wt_live_…` or `X-Api-Key` | Server-to-server ticket create |
| Help widget | Public `wgt_…` id (no secret in browser) | Customer web form → ticket |
| Public help center | None | Browse published KB at `/hc/{org-slug}` |
| Email adapter | Org API key | Inbound email → ticket / thread reply |
| Python agents | Header `X-Coworker-Tasks-Key` | Express → `ai-agents` |

---

## 3. Roles (who can do what)

Roles mirror MyAccount: **Admin**, **Agent**, **Resolver**, **Customer**, plus legacy **Viewer**.

| Role | Portal label | Responsibility |
|------|--------------|----------------|
| **admin** | ADMIN PORTAL | Full org: all tickets, teams, analytics, audit, CSAT, org prefs (API keys, widgets), config |
| **agent** | AGENT PORTAL | L1 support: own tickets, team inbox, unassigned, create, Teams, KB, customers, macros |
| **resolver** | RESOLVER PORTAL | L2 technical work: My Tickets, Work board, KB (read), settings |
| **customer** | CUSTOMER PORTAL | Create tickets, see **own** tickets, limited account settings |
| **viewer** | VIEWER PORTAL | Read-only org view (dashboard, search, all tickets, teams, KB, customers, analytics) |

### Data scope by role

| Role | Ticket list scope |
|------|-------------------|
| admin, viewer | Whole organization |
| agent, resolver | Primarily assignee / resolver ownership (+ team scopes where allowed) |
| customer | Requester (their own tickets only) |

### Who can create tickets (in-app)

Admin, Agent, Customer. Viewer and Resolver cannot use Create Ticket.

---

## 4. Modules (UI) — purpose of each

Sidebar modules are role-gated (`ui-frontend/src/rbac.ts`).

### Home & discovery

| Module | Sidebar label | Purpose |
|--------|---------------|---------|
| **dashboard** | Home | KPI cards (open, on hold, overdue, due today, unassigned), charts, recent activity |
| **search** | Search | Find tickets across accessible scope |

### Tickets

| Module | Sidebar label | Purpose |
|--------|---------------|---------|
| **create-ticket** | Create Ticket | Guided or form create; AI triage can fill subject, priority, team, assignee |
| **assigned** | Tickets / My Tickets | Tickets owned by the signed-in user (agents/resolvers) or by the customer as requester |
| **team-inbox** | Team inbox | Tickets for teams the agent belongs to |
| **unassigned** | Unassigned | Tickets with no assignee |
| **team-queue** | All tickets | Org-wide ticket list (admin / viewer) |
| **work-board** | Work board | Resolver board for L2 workload |

### Ticket detail (inside ticket views)

- Status, priority, assignee, queue / team, notes (internal vs public)
- Attachments (upload)
- SLA due time (`due_at`), creation time, resolved time
- Presence banner (“X is viewing”) to reduce collisions
- Escalate / assign resolver (L2) while keeping L1 agent
- CSAT rating after resolve (customer)

### Teams & directory

| Module | Sidebar label | Purpose |
|--------|---------------|---------|
| **agent-queues** | Teams | Support queues/teams, membership, open/SLA health |
| **customers** | Customers | Customer directory (name, email, phone, ticket count) |
| **kb** | Knowledge Base | Internal/published articles; powers public help center when Published |
| **escalation-directory** | Escalation directory | Who to escalate to / L2 directory |

### Insights & quality

| Module | Sidebar label | Purpose |
|--------|---------------|---------|
| **analytics** | Analytics | Volume, resolve time, first response, channels, agent performance, SLA breach report |
| **csat-reports** | CSAT reports | Customer satisfaction scores after resolve |
| **audit** | Audit log | Append-only trail of ticket actions (create, assign, escalate, status, notes) |

### Productivity & config

| Module | Sidebar label | Purpose |
|--------|---------------|---------|
| **macros** | Macros | Saved reply templates for notes |
| **priorities** | Priorities | Priority-related org view / config surface |
| **org-preferences** | Org preferences | Org settings: ticket prefix, portal label, timezone, **API keys**, **Help widgets**, help center URL |
| **settings** | Account Settings | Personal profile, security, sessions, notifications, preferences, danger zone |

### Account Settings sections (by role)

| Section | admin | agent | resolver | customer | viewer |
|---------|-------|-------|----------|----------|--------|
| Profile | ✓ | ✓ | ✓ | ✓ | ✓ |
| Security (password, 2FA flag) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Sessions (revoke devices) | ✓ | ✓ | ✓ | | |
| Notifications prefs | ✓ | ✓ | ✓ | | |
| Login activity | ✓ | ✓ | ✓ | | |
| Preferences (language, timezone, date format) | ✓ | ✓ | ✓ | | ✓ |
| Danger (deactivate / delete data) | ✓ | | | | |

---

## 5. Co-worker (AI assistant)

Split workspace chat available while working in modules.

| Piece | Use |
|-------|-----|
| **Chat specialists** | Tickets, Teams, KB, Customers, General — routed by LangGraph |
| **Triage-assign task** | On create: categorize, pick team, assign L1 agent (+ optional L2 resolver by confidence) |
| **Intent routing** | Natural language can open modules or start create/team flows |

Express: `POST /api/coworker/chat` → Python `COWORKER_AGENTS_URL` (`ai-agents`).

If Python is down, Express falls back to lighter Node enrich where possible.

---

## 6. Ticket lifecycle (high level)

```text
Create (UI / widget / email / API)
        ↓
Triage (category, skill, priority, queue)
        ↓
Assign L1 Agent (+ optional L2 Resolver)
        ↓
Work (notes, status: Open → Pending → On Hold → Resolved)
        ↓
SLA: due_at from sla_policies by priority
        ↓
Resolve → resolved_at set → optional CSAT + customer email
```

**Statuses:** `Open` | `Pending` | `On Hold` | `Resolved` | `Overdue`  
**Priorities:** `urgent` | `high` | `medium` | `low`  
**Channels:** `Email` | `Chat` | `Phone` | `Web` (intake maps `web_form` / `api` etc.)

### SLA (DB-driven)

Hours live in `ticketing.sla_policies` (seeded from `sla_policy_defaults`), not hardcoded in runtime logic.

| Priority | Resolution (default) | First response (default) |
|----------|----------------------|----------------------------|
| urgent | 4h | 1h |
| high | 8h | 2h |
| medium | 24h | 4h |
| low | 72h | 8h |

Ticket times: `created_at`, `due_at`, `first_response_at`, `resolved_at`.

---

## 7. Integrations & public surfaces

| Feature | Who uses it | Purpose |
|---------|-------------|---------|
| **Org API keys** | Admin (Org preferences) | Authenticate intake / email adapters |
| **Intake API** | External systems | `POST /api/intake/tickets` create cases |
| **Help widget** | Website visitors | Embed `wgt_…` → create ticket without login |
| **Email in** | Mail provider → `/api/intake/email` | New ticket or threaded reply via Message-ID |
| **Email out** | System → customer | Created / reply / resolved notifications (SMTP or log mode) |
| **Automation rules** | Org | If/then on `ticket.created` / `ticket.updated` (priority, queue, assign, notify) |
| **Public help center** | Anyone | `/hc/{slug}` published KB search & articles |
| **Presence** | Agents | Heartbeat while viewing a ticket |

---

## 8. Notifications

In-app notifications (`notifications` table) for assignments, updates, SLA alerts (respecting user prefs such as `notify_sla_alerts`). Users can mark read / clear from the header.

---

## 9. Databases & schemas

| Database | Schema | Role |
|----------|--------|------|
| App DB (from `DATABASE_URL`) | **`ticketing`** | All product tables |
| **`ticketing_skills`** | (skills tables) | Agent skill catalog for assignment |

MyAccount’s `accounts` schema is read for sync only — ticketing does not own onboarding writes.

Full table catalog: [database-tables.md](./database-tables.md).

---

## 10. Project layout (where things live)

```text
Ticketing_Rebuild/
├── ui-frontend/          # React app (modules, login, RBAC, co-worker UI)
├── ui-backend/           # Express API, auth, SLA, intake, bootstrap
├── ai-agents/            # Python LangGraph chat + triage-assign
├── sql/                  # Optional SQL migrations (001…007)
├── docs/                 # Product & integration docs
└── uploads/              # Local file attachments
```

---

## 11. Quick “who uses what” matrix

| Need | Module / path |
|------|----------------|
| Sign in | Login → `/api/auth/login` |
| See KPIs | Home (dashboard) |
| File a case (staff/customer) | Create Ticket |
| File a case (website) | Help widget |
| File a case (system) | Intake API + API key |
| Work my queue | My Tickets / Team inbox / Unassigned |
| L2 work | Work board (resolver) |
| Manage teams | Teams |
| Answers for agents / public | Knowledge Base + `/hc/{slug}` |
| Performance | Analytics + CSAT + Audit |
| Integrate CRM / email | Org preferences → API keys + widgets |
| Change password / devices | Account Settings |
| Ask the product questions | Co-worker chat |

---

## 12. Environment essentials

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Main Postgres (schema `ticketing`) |
| `SKILLS_DATABASE_URL` | Skills DB |
| `JWT_SECRET` | Auth cookie signing |
| `COWORKER_AGENTS_URL` | Python agents base URL |
| `COWORKER_TASKS_SECRET` | Shared secret Express ↔ agents |
| `SEED_DEMO` / `SEED_DEMO_PASSWORD` | Local demo admin only |
| `MAIL_MODE` / SMTP_* | Outbound customer email |

See repo-root `.env.example` for the full list.
