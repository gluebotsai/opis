# Worktual Ticketing — Modules & Tasks (What’s Built)

This document explains **what exists in the ticketing system today**: product modules, backend domains, AI tasks, roles, and how the pieces fit together.

Related docs:

- [product-overview.md](./product-overview.md) — product narrative & roles
- [architecture-freeze.md](./architecture-freeze.md) — frozen LangGraph ownership
- [agents.md](./agents.md) — chat specialists + triage
- [ticketing_flow.md](./ticketing_flow.md) — lifecycle Flows 1–4
- [database-tables.md](./database-tables.md) — Postgres tables
- [STRUCTURE.md](../STRUCTURE.md) — repo layout & how to run

---

## 1. What the system is

**Worktual Ticketing** is a multi-tenant helpdesk / CRM console:

| Concern | Owner |
|---------|--------|
| UI (forms, lists, metrics display) | React (`ui-frontend`) |
| Auth, RBAC, validation, audit, **all DB writes** | Express (`ui-backend`) |
| Conversation orchestration, workflow state, tool choice, phrasing | LangGraph (`ai-agents`) |
| Source of truth | PostgreSQL (`ticketing` schema) |

**Local defaults**

| Service | URL / port |
|---------|------------|
| UI + API | `http://127.0.0.1:3000` (`npm run dev`) |
| AI agents | `http://127.0.0.1:8012` (`npm run dev:agents`) |

**One mutation path forever:** React / Chat / Slack / Intake → **Express APIs** → Postgres.  
LangGraph never writes SQL directly. Dashboard metrics never go through chat.

---

## 2. Repo layout (what each folder does)

| Path | Responsibility |
|------|----------------|
| `ui-frontend/` | React + Vite app: views, coworker chat UI, RBAC gates |
| `ui-backend/` | Express API, JWT auth, Postgres access, proxies to agents |
| `ai-agents/` | FastAPI + LangGraph: `/chat`, phrase, triage-assign, tools |
| `sql/` | Schema migrations `001`–`010` |
| `docs/` | Product, architecture, schema, intake docs |
| `scripts/` | Smoke / e2e / role / chat test runners |
| `uploads/` | Multer file storage |
| `.cursor/rules/` | No static chat replies; no hardcoded business data in UI |

---

## 3. Roles & portals

| Role | Portal | What they can do (high level) |
|------|--------|-------------------------------|
| **admin** | Admin | Full org: all tickets, teams, analytics, audit, CSAT, org prefs, catalogs |
| **agent** | Agent (L1) | My tickets, team inbox, unassigned, create, KB, customers, macros |
| **resolver** | Resolver (L2) | My tickets, work board, KB (read), settings — no ticket create |
| **customer** | Customer | Create + see **own** tickets; limited settings |
| **viewer** | Viewer | Read-oriented org view (dashboard, search, tickets, KB, customers, analytics) |

**Data scopes:** admin/viewer → org · agent/resolver → assignee · customer → requester.

Coded in: `ui-frontend/src/rbac.ts`, `ui-backend/src/rbac.ts`, `ai-agents/app/rbac.py`.

---

## 4. Frontend modules (screens)

Router: `ui-frontend/src/App.tsx`.

| Module (view id) | UI component | What it does |
|------------------|--------------|--------------|
| Login | `LoginView` | Email/password → JWT cookie |
| **Dashboard** | `DashboardView` | Home KPIs, charts, activity (API data only) |
| **My Tickets** (`assigned`) | `TicketsView` | Tickets assigned to the user |
| **All Tickets** (`team-queue`) | `TicketsView` | Org-wide ticket list (role-gated) |
| **Team Inbox** (`team-inbox`) | `TicketsView` | Queue/team-scoped inbox |
| **Unassigned** | `TicketsView` | Tickets with no assignee |
| **Search** | `TicketsView` | Search across allowed scope |
| **Work Board** | `WorkBoardView` | Resolver L2 board |
| **Create Ticket** | `CreateTicketView` | Guided/form create + enrich (triage) |
| **Teams / Queues** | `AgentQueuesView` | Create/update/delete teams, members |
| **Knowledge Base** | `KnowledgeBaseView` | Articles (CRUD by role) |
| **Customers** | `CustomersView` | Customer directory / 360 |
| **Macros** | `MacrosView` | Saved reply macros |
| **Priorities** | `PrioritiesView` | Priority catalog |
| **Analytics** | `AnalyticsView` | Reports / aggregates |
| **Audit Log** | `AuditLogView` | Audit trail |
| **CSAT Reports** | `CsatReportsView` | Customer satisfaction reports |
| **Escalation Directory** | `EscalationDirectoryView` | L2 / escalation roster |
| **Org Preferences** | `OrgPreferencesView` | Branding, API keys, widgets |
| **Settings** | `SettingsView` | Account profile, security, prefs |

**Co-worker chat shell:** `components/coworker/*` — split workspace, chat panel, guided previews, applies `ui_actions` (navigate / filter / wizards) beside forms.

---

## 5. Backend API modules (Express)

Entry: `ui-backend/server.ts`. All business writes go here.

| API domain | Prefix | Tasks covered |
|------------|--------|---------------|
| Auth | `/api/auth/*` | login, logout, me |
| Account | `/api/account/*` | profile, password, security, notifications prefs, sessions, deactivate |
| Notifications | `/api/notifications/*` | list, mark read, clear |
| **Tickets** | `/api/tickets` | list/get/create/update, notes, progress, escalate, presence, enrich, chat-reply |
| **Customers** | `/api/customers` | directory + 360 |
| **Queues / Teams** | `/api/queues` | list/create/patch/delete, members |
| **Knowledge Base** | `/api/kb` | list/create articles |
| **Macros** | `/api/macros` | CRUD macros |
| **Priorities / Statuses** | `/api/priorities`, `/api/statuses` | catalogs |
| Metrics / Dashboard | `/api/metrics`, `/api/dashboard/chart` | KPIs & charts |
| Analytics | `/api/analytics` | aggregates + export |
| Activities / Agents | `/api/activities`, `/api/agents`, `/api/roster` | feed, roster, triage stats |
| Audit / CSAT | `/api/audit`, `/api/csat-reports` | compliance & CSAT |
| Escalation directory | `/api/escalation-directory` | L2 directory |
| Org branding / prefs | `/api/org-branding`, `/api/org-preferences` | org config |
| **Co-worker** | `/api/coworker/*` | chat gateway, guided-reply, ui-actions, ticket-reason |
| **Intake** | `/api/intake/tickets`, `/api/intake/email` | API-key / email ticket create |
| Integrations | `/api/integration/keys`, `/api/integration/widgets` | org keys & widgets |
| Automation | `/api/automation/rules` | automation rules |
| Public help | `/api/public/help/*`, `/hc/:slug` | published KB |
| Public widget | `/api/public/widgets/*` | embeddable ticket form |
| Uploads | `/api/uploads` | attachments |
| Health | `/api/health` | liveness |

---

## 6. Product tasks by module (what users can do)

### 6.1 Tickets

| Task | How |
|------|-----|
| Create ticket | Form (`CreateTicketView`) and/or chat; enrich via triage-assign |
| List / filter / search | Ticket views + chat `ui_actions` filters |
| Update status / priority | Form + chat tools (`update_ticket`) |
| Add notes | Form + chat (`add_ticket_note`) |
| Escalate / reassign | Escalate API + chat escalate draft |
| Track SLA / overdue | Priority-based `due_at`; Overdue automation |
| Attachments | `/api/uploads` |

### 6.2 Teams / Queues

| Task | How |
|------|-----|
| Create team | Form + chat create-team workflow |
| Add members | Form + chat `add_team_members` (uses `last_entity` after create) |
| Update / delete team | Form + chat (admin) |
| Route tickets to queue | Triage-assign + queue membership |

### 6.3 Customers

| Task | How |
|------|-----|
| Browse directory | Customers view + chat list tool |
| Customer 360 | `/api/customers/360` |
| Create / update (where permitted) | Express customer APIs + form |

### 6.4 Knowledge Base

| Task | How |
|------|-----|
| Browse / search articles | KB view + chat |
| Create / publish article | Form + chat guided KB draft |
| Public help center | `/hc/{org-slug}` (published only) |

### 6.5 Macros, priorities, statuses

| Task | How |
|------|-----|
| Create / edit macros | Macros view + chat create-macro draft |
| Manage priorities | Priorities view + catalog APIs |
| Status catalog | `/api/statuses` + SQL catalog migrations |

### 6.6 Analytics, audit, CSAT

| Task | How |
|------|-----|
| Dashboard KPIs | React → Express → Postgres (never via chat) |
| Analytics ranges | `/api/analytics` |
| Audit trail | Audit log view |
| CSAT reports | CSAT view + ticket scores in DB |

### 6.7 Org & integrations

| Task | How |
|------|-----|
| Org preferences / branding | Org Preferences view |
| API keys for intake | Integration keys |
| Help widgets | Public widget + org widgets API |
| Automation rules | `/api/automation/rules` |

### 6.8 Account & notifications

| Task | How |
|------|-----|
| Profile / password / sessions | Settings |
| In-app notifications | Notifications APIs + UI |

---

## 7. AI co-worker — modules & tasks

Service: `ai-agents/` (FastAPI on **8012**).  
Model default: **`worktual-gemma`**.

### 7.1 Frozen chat graph

```text
prepare
  → workflow_manager     # continue / park / resume / last_entity
  → commands (shim)      # new mutations / nav (being drained)
  → cheap intent
  → policy (RBAC + route)
  → Ticket | Teams | KB | Customers | General agents
  → domain tools → Express → Postgres
  → LLM phrase reply + ui_actions
```

Principles (see [architecture-freeze.md](./architecture-freeze.md)):

1. Express owns mutations  
2. LangGraph owns orchestration + workflow state  
3. Workflow Manager is state-first (no restart on “add members”)  
4. LLM owns language only (not RBAC / SQL)  
5. One response contract: `{ reply, ui_actions, data, agent }`  
6. Chat ↔ form parity via same Express APIs  

### 7.2 Chat agent modules

| Agent | File | Typical tasks |
|-------|------|----------------|
| **Tickets** | `agents/tickets.py` | List/get tickets, escalate, create/update, notes, metrics |
| **Teams** | `agents/teams.py` | List/create/update/delete queues |
| **KB** | `agents/kb.py` | List/create articles |
| **Customers** | `agents/customers.py` | List customers |
| **General** | `agents/general.py` | Greetings, help, navigate, macros/metrics helpers |

### 7.3 Workflow Manager tasks

| Workflow | Steps (conceptually) | Outcome |
|----------|----------------------|---------|
| `create_team` | name → confirm | POST queue; set `last_entity` |
| `add_team_members` | members / names | PATCH queue members |
| `delete_team` | confirm | DELETE queue |
| `create_macro` | title → body → confirm | Save macro |
| `create_kb` | title → category → body → confirm | Publish article |
| `escalate` | ticket → assignee → note | Escalate via Express |
| `create_ticket` | guided fields | POST ticket |

Also: **park** mid-flow for side quests, **resume** later without re-asking collected fields.

### 7.4 AI HTTP task APIs

| Endpoint | Task | Implementation |
|----------|------|----------------|
| `POST /chat` | Full co-worker turn | `graph.run_chat` |
| `POST /phrase` | Phrase a guided step (no static chat bubbles) | `tasks/phrase.py` |
| `POST /ui-actions` | Resolve navigate / filter actions | `tasks/ui_actions.py` |
| `POST /tasks/triage-assign` | Categorize → team → assignee (Flows 2–4) | `tasks/pipeline.py` |
| `POST /ticket-reason` | Classify create-ticket turn | `tasks/ticket_reason.py` |
| `POST /insights` | Analytics insights | `tasks/insights.py` |
| `GET /health` | Service health | `main.py` |

Auth between Express and agents: header `X-Coworker-Tasks-Key`.

### 7.5 Domain tools (agents → Express)

| Area | Example tools |
|------|----------------|
| Tickets | `list_tickets`, `get_ticket`, `create_ticket`, `update_ticket`, `escalate_ticket`, `add_ticket_note` |
| Teams | `list_queues`, `create_queue`, `update_queue`, `delete_queue` |
| KB | `list_kb`, `create_kb_article` |
| Customers | `list_customers` |
| General | macros, metrics, analytics, org prefs, notifications |

Allowlists: `ai-agents/app/tools/registry.py`.

---

## 8. Ticket lifecycle tasks (Flows 1–4)

Documented in detail in [ticketing_flow.md](./ticketing_flow.md). Implemented spine:

| Flow | What happens |
|------|----------------|
| **1 — Create** | Customer/staff submit issue → ticket row |
| **2 — Categorize** | Triage LLM/heuristics → category, skill, priority, subject |
| **3 — Team** | Map skill → support queue |
| **4 — Assign** | Pick agent by skill + workload |

Trigger: create UI enrich (`POST /api/tickets/enrich`) and/or create path → `POST /tasks/triage-assign`.

---

## 9. Database & migrations (what’s modeled)

Schema under `sql/`:

| Migration | Focus |
|-----------|--------|
| `001_create_schema.sql` | Core ticketing schema |
| `002_seed_data.sql` | Local seed (when used) |
| `003_enhancements.sql` | Enhancements |
| `004_account_settings.sql` | Account / settings |
| `005_queue_members.sql` | Team membership |
| `006_skills_db.sql` | Skills DB for assignment |
| `007_sla_policies.sql` | SLA policies |
| `008_priority_catalog.sql` | Priority catalog |
| `009_ticket_status_catalog.sql` | Status catalog |
| `010_remove_on_hold_status.sql` | Status cleanup |

Details: [database-tables.md](./database-tables.md), [ticketing-schema-columns.md](./ticketing-schema-columns.md).

---

## 10. Integrations & external entry points

| Channel | Auth | Task |
|---------|------|------|
| Staff / customer portal | JWT cookie | Full console |
| Intake API | `Bearer wt_live_…` / API key | Server ticket create |
| Email adapter | Org API key | Inbound email → ticket |
| Help widget | Public `wgt_…` | Browser form → ticket |
| Public help center | None | Browse published KB |
| MyAccount hybrid | Shared user IDs / hashes | Identity onboarding |

See [intake-api.md](./intake-api.md), [INTEGRATIONS_README.md](./INTEGRATIONS_README.md).

---

## 11. Engineering rules that shape “what’s done”

| Rule | Effect |
|------|--------|
| No hardcoded business data in UI | Counts, CSAT, lists come from APIs only |
| No static chat replies | User-visible chat text is LLM-phrased; seeds are hints only |
| Express sole mutator | Chat tools call Express; no second business path |
| Lean chat SLO | Greetings / no-tool turns aim &lt;2s |

---

## 12. How to run (quick)

```bash
# App (UI + Express)
npm install
cp .env.example .env   # DATABASE_URL, JWT_SECRET, COWORKER_AGENTS_URL, …
npm run dev            # http://127.0.0.1:3000

# AI agents (separate terminal)
npm run dev:agents     # http://127.0.0.1:8012
```

---

## 13. Status summary

| Area | Status |
|------|--------|
| Multi-role portals & RBAC | Built |
| Tickets CRUD, notes, escalate, SLA | Built |
| Teams/queues + members | Built (chat + form) |
| Customers, KB, macros, priorities | Built |
| Dashboard / analytics / audit / CSAT | Built (API-backed) |
| Intake, widgets, help center | Built |
| Co-worker chat (LangGraph + Gemma) | Built |
| Workflow Manager + `last_entity` | Built (foundation; commands shim still draining) |
| Triage-assign (Flows 2–4) | Built |
| Chat ↔ form full parity | In progress (architecture frozen) |

---

*This file is the module/task map of what is implemented. For frozen ownership rules, prefer [architecture-freeze.md](./architecture-freeze.md). For role-by-role UX, prefer [product-overview.md](./product-overview.md).*
