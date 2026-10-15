# Worktual SDK — Feature Packaging Guide

**Audience:** Developers at SaaS companies integrating Worktual CRM / AI into their products.  
**Goal:** Ship **UI + Backend** bundles and **Backend-only** APIs without forcing a full CRM UI takeover.  
**Source of truth:** Worktual Vite + Fastify CRM, Python `ai-service` agents, shared DB boundaries (`cdp`, `accounts`, `inventory`, `crm`).

---

## 1. Packaging principles

| Principle | Meaning for the SDK |
|---|---|
| Tenant isolation | Every call carries org / tenant context; no cross-tenant data. |
| Host owns identity (optional) | Host can map its users → Worktual users via SSO / API keys. |
| Shared schemas are read/overlay | SDK never owns DDL on `cdp` / `accounts` / `inventory`; CRM overlays live in `crm.*`. |
| Agents are LLM-backed | AI features call `ai-service`; no heuristic “fake AI” in the SDK client. |
| Confirm mutations | Coworker-style creates/updates stay proposal → host confirm, unless host opts into auto-apply. |
| Bundle by surface | Ship **embeddable UI** where UX is differentiated; ship **API-only** for pipelines and jobs. |

### Bundle types

| Bundle type | What the host gets | Typical use |
|---|---|---|
| **UI + Backend** | Prebuilt React (or iframe/web-component) UI + Worktual APIs | Drop-in panels, forms, assist sidebars |
| **Backend-only** | REST / SDK clients / webhooks / agent run APIs | Host builds its own UI |
| **AI capability** | Named agent or coworker skill over host or Worktual data | Scoring, coaching, compose, nurture |

---

## 2. Product modules → SDK packaging

### 2.1 Master matrix

| Feature / module | Bundle? | UI + Backend | Backend-only | Primary data / DB | Integration pattern |
|---|---|---|---|---|---|
| Auth / org tenancy | Yes (required) | Login / SSO connect widget (optional) | API keys, JWT, org resolve | `accounts.*` | Host SSO or Worktual API key |
| Contacts / leads | Yes | Contact list, detail, create form | CRUD, search, merge APIs | `cdp.customer_profile`, `cdp.identity_keys`, `crm.contact_profiles` | Embed list/detail **or** sync host party IDs → `cdpId` |
| Companies / locations | Yes | Company list, detail, forms | CRUD APIs | `crm` companies/locations (+ org industry packs) | Embed or API; link contacts by company id |
| Inbox / email | Yes (high value) | Inbox UI, compose, thread view | Sync, send, thread APIs | Mail provider tokens, `crm` activities / threads | OAuth connect in host; webhook or poll sync |
| Activities (email/call/meeting/task/note) | Yes | Activity timeline, log activity | Create/list APIs | `crm.contact_activities` | Embed timeline on host “customer” page |
| Sales / deals / pipeline | Yes | Pipeline board, deal detail | Deal CRUD, stage APIs | `crm` deals | Embed board **or** stage webhooks to host |
| Quotes / proposals | Yes | Quote/proposal editors | Document APIs, send | `crm` quotes/proposals, templates | Embed editor; host deep-link to deal |
| Products / catalog | Partial | Product picker UI | Product search/list (DML only) | `inventory.products` | Backend catalog read; picker as UI bundle |
| Commerce orders (B2C / B2B2C) | Yes | Order list/detail | Order APIs | `crm` commerce | Host checkout → order create API |
| Finance / invoices (B2B / B2B2C) | Yes | Invoice list/detail, approve/send | Invoice lifecycle APIs | `crm` invoices | Embed finance panel; host payment gateway later |
| Dashboard / KPIs | Partial | KPI cards / report layout | Metrics query APIs | Aggregates over `crm` + invoices | Backend metrics; optional embed cards |
| Reports / analytics chat | Yes | Reports page + analytics chat | Analytics agent API | Authorized CRM aggregates | Embed chat; RBAC from host role map |
| Agents dashboard | Optional | Agent runs UI | Job status APIs | `crm` agent job tables | Backend jobs; UI for ops tenants only |
| Configuration (email, calendar, presence) | Partial | Connect-email / calendar wizards | Integration token APIs | `user_integration_connections`, bot mailbox | Host redirects to OAuth; SDK stores tokens |
| Voice / SIP / presence | Advanced | Softphone toolbar (optional) | Presence + call APIs | Redis ACD, SIP gateway | Backend-first; UI only if host wants dialer |
| Meeting notetaker + Sales Assist | Yes (high value) | Meet add-on / assist panel | Live caption, session, SSE | Meeting-service, Vexa, `crm` assist sessions | Embed assist panel; bot join via API |
| Service / Marketing micros | Partial | Deep-link shells | Webhook handoffs | External MS DBs | Prefer backend webhooks; avoid embedding foreign UIs |
| Notifications | Yes | Bell widget | Notify / CRM-bot email APIs | `crm.notifications` | Embed bell; host can also consume webhook |

---

## 3. UI + Backend bundles (recommended first wave)

These are strong embed candidates: clear UX, clear APIs, high differentiation.

### 3.1 Contact / Lead embed

| Item | Detail |
|---|---|
| **UI** | List, detail pane, create/edit form, activity timeline strip |
| **Backend** | Contact CRUD, identity resolve, owner assign, lead status |
| **Data** | Profile: `cdp.customer_profile`; emails/phones: `cdp.identity_keys`; overlays: `crm.contact_profiles` |
| **Integrate** | Mount `<WorktualContacts />` with `tenantId` + host `externalUserId`; or map host customer id → Worktual `cdpId` |

### 3.2 Inbox + compose

| Item | Detail |
|---|---|
| **UI** | Folder list, thread, compose, AI suggest reply |
| **Backend** | Mail sync, send (user mailbox or CRM bot), auto-reply jobs |
| **Data** | Provider OAuth; activities with `email_direction` / thread ids |
| **Integrate** | OAuth “Connect mailbox” in host settings; embed Inbox route; listen to inbound webhooks |

### 3.3 Sales Assist (live meeting)

| Item | Detail |
|---|---|
| **UI** | Side panel (“I’m listening”, Heard, coaching, ask box) |
| **Backend** | Assist session, live-caption ingest, SSE events, ask agent |
| **Data** | Meeting activity, contact, product catalog for coaching, employee roster |
| **Integrate** | Host opens panel with `meetingUrl` / `activityId`; Worktual Notetaker joins Meet; host need not own Vexa |

### 3.4 Deal pipeline + deal detail

| Item | Detail |
|---|---|
| **UI** | Kanban / pipeline, deal drawer |
| **Backend** | Deal CRUD, stage transitions, audit |
| **Data** | `crm` deals, company/contact links, amounts |
| **Integrate** | Embed board; sync stage changes to host via webhook |

### 3.5 Quote / proposal viewer-editor

| Item | Detail |
|---|---|
| **UI** | Document shell, section edit, send |
| **Backend** | Quote/proposal APIs, template apply, send |
| **Data** | Lines → `inventory.products`; deal/contact context |
| **Integrate** | Open from host deal id; optional “generate with AI” button |

### 3.6 Co-worker chat shell

| Item | Detail |
|---|---|
| **UI** | Module chat panel (navigate, draft forms, propose save) |
| **Backend** | `crm-agent` + MCP tools scoped by module/role |
| **Data** | Whatever modules the host enabled |
| **Integrate** | Embed chat with `module=contact|sales|…`; host confirms mutations |

### 3.7 Notification bell

| Item | Detail |
|---|---|
| **UI** | Bell + list (“lead assigned”, escalations) |
| **Backend** | Notifications API + optional CRM-bot email |
| **Data** | `crm.notifications`; delivery emails from setup users |
| **Integrate** | Embed in host chrome; map host user → Worktual user id |

---

## 4. Backend-only bundles (API / services)

Prefer these when the host already has UI, or for async pipelines.

### 4.1 Lead intelligence pipeline

| Capability | API shape | Data needed | Integrate |
|---|---|---|---|
| Enrich lead | `POST …/agents/enrich-lead/run` | Contact + company name/domain | On lead create webhook from host |
| Score lead | `POST …/agents/score-lead/run` | Profile, activities, inbound counts | After enrich or engagement |
| Summarize lead | `POST …/agents/summarize-lead/run` | Score context | Persist summary on host or CRM |
| Assign sales | `POST …/agents/assign-sales/run` | Territory/load settings, rep roster | Host receives owner id + notify |
| Nurture | Job + cron / `nurture-lead` | Phone/email, org nurture settings, CRM bot | Host enables voice/email channels |
| Lifecycle | `lifecycle-lead` | Stage + engagement signals | Host maps stages to its funnel |

### 4.2 Messaging & compliance

| Capability | Bundle | Data | Integrate |
|---|---|---|---|
| Auto-reply email | Backend jobs | Inbound activity, mailbox, policy | Point inbound mail at Worktual sync or forward |
| Compose email | On-demand API | Contact/deal context | Host “AI draft” button → insert body |
| Welcome / owner-change notify | Backend | Owner delivery email, contact | Trigger after assignment |
| Compliance / privacy | Backend | Inbound mail classification | Host admin queue for deletion |

### 4.3 Meetings & transcripts

| Capability | Bundle | Data | Integrate |
|---|---|---|---|
| Notetaker dispatch | Backend | Meet/Zoom URL, consent | Host calendars schedule → API join |
| Analyze transcript | Backend | Transcript text | Host posts transcript or uses capture |
| Meeting brief / MoM | Backend | Meeting + contact context | Email via bot or host SMTP |
| Post-meeting process | Backend | Transcript → draft quote/proposal | HITL send in host |

### 4.4 Commercial / finance agents

| Capability | Bundle | Data | Integrate |
|---|---|---|---|
| Invoice escalation / dunning | Backend cron | Invoices, deal owner | Host reviews drafts; human send |
| Collection risk / revenue gap | Backend read | Invoice history | Host dashboard widgets via metrics API |
| Expansion matcher | Backend HITL | Deal history | Host reviews outreach draft |
| Forecast audit | Backend HITL | Deal forecast overlays | Never auto-change stage |

### 4.5 Catalog & tenancy utilities

| Capability | Bundle | Data | Integrate |
|---|---|---|---|
| Product search | Backend | `inventory.products` (DML/read) | Host SKU picker |
| Org / role matrix | Backend | `accounts` roles, business_type | Map host roles → Worktual modules |
| Webhooks | Backend | Outbox events | Host subscribes to contact/deal/invoice events |

---

## 5. AI capabilities that can be bundled

### 5.1 Embeddable AI (UI + Backend)

| AI capability | UI surface | Agent / service |
|---|---|---|
| In-app co-worker | Chat shell | `crm-agent` + specialists |
| Live Sales Assist | Meet / call panel | `assist-meeting` + live caption path |
| Analytics Q&A | Reports chat | `reports-analytics-agent` |
| Suggest reply | Inbox compose | `compose-email` / auto-reply draft |
| Proposal section rewrite | Proposal editor | `proposal-content`, clone-personalize |

### 5.2 API AI (Backend-only)

| AI capability | Agent | Host trigger |
|---|---|---|
| Lead enrich / score / summarize | `enrich-lead`, `score-lead`, `summarize-lead` | Lead created / updated |
| Assign / welcome / nurture / lifecycle | `assign-sales`, `welcome-lead`, `nurture-lead`, `lifecycle-lead` | Score gate / cron |
| Sales coach | `sales-coach` | After call/meeting |
| Transcript analysis | `analyze-transcript` | Transcript ready |
| Meeting brief / MoM / miss | `meeting-brief-email`, `meeting-mom`, `meeting-miss-escalation` | Calendar / capture events |
| Auto-reply | `auto-reply-email` | Inbound email |
| Compliance | `compliance-privacy` | Sensitive inbound |
| Invoice / expansion / forecast agents | Named cron agents | Scheduler or host cron |
| Prospecting | `prospect-search`, `prospect-qualify`, `prospect-personnel` | Host research UI |

### 5.3 Not recommended as public SDK (initially)

| Item | Why |
|---|---|
| Full proposal corpus / playbook training stack | Heavy ops, long jobs, internal quality gates |
| Raw MCP catalog to arbitrary clients | Mutation risk; keep behind coworker confirm |
| Direct shared-DB credentials | Breaks multi-tenant and schema ownership |
| In-bot Whisper / Vexa internals | Ops surface; expose only “join notetaker” + assist APIs |

---

## 6. Data & database access by feature

### 6.1 Shared DB rules (locked)

| Schema | SDK may | SDK must not |
|---|---|---|
| `cdp` | SELECT / use existing identity columns | CREATE/ALTER/DROP; invent columns; rely on legacy `cdp.contacts` |
| `accounts` | SELECT users/roles/org; approved A2A client rows | Own schema (except approved exceptions) |
| `inventory` | SELECT/DML on existing `products` columns | Product DDL |
| `crm` | Full product state (profiles, deals, activities, jobs) | Leak other tenants |

### 6.2 Per-feature data requirements

| Feature | Minimum host-supplied data | Worktual-stored data |
|---|---|---|
| Contacts | External id, email/phone, name | CDP profile + CRM overlay (owner, lifecycle, BANT) |
| Lead AI pipeline | Contact id, org id, optional company domain | Enrichment jobs, scores, nurture jobs |
| Inbox / auto-reply | Mailbox OAuth or CRM bot config | Threads, activities, auto-reply jobs |
| Deals / quotes | Contact/company ids, products | Deal/quote/invoice rows |
| Meeting Assist | Meeting URL, host user, contact link | Assist session, captions, suggestions |
| Notifications | Recipient user ids | `notifications` + optional bot email |
| Finance agents | Invoice ids / org | Invoice state, escalation drafts |
| Voice | SIP user / presence | Presence Redis, call transcripts (frozen paths unless requested) |

---

## 7. How hosts integrate

### 7.1 Common integration patterns

```
┌────────────────────┐     OAuth / API key      ┌──────────────────┐
│  Host SaaS app     │ ───────────────────────► │  Worktual API    │
│  (their UI)        │ ◄──── webhooks / SSE ─── │  Fastify + CRM   │
└─────────┬──────────┘                          └────────┬─────────┘
          │ Embed SDK UI (optional)                      │
          ▼                                              ▼
┌────────────────────┐                          ┌──────────────────┐
│ Worktual widgets   │                          │ ai-service       │
│ (React / iframe)   │                          │ agents + MCP     │
└────────────────────┘                          └──────────────────┘
```

| Pattern | When to use |
|---|---|
| **Embedded UI** | Fastest time-to-value; host lacks CRM UX |
| **Headless API** | Host already has contacts/deals UI |
| **Hybrid** | Host list + Worktual detail/assist/chat |
| **Event-driven** | Host creates lead → Worktual pipeline → webhook owner assigned |
| **Bring-your-own-ID** | Pass host `externalId` / `cdpId`; Worktual stores mapping |

### 7.2 Auth options for SDK

1. **Organization API key** — server-to-server backend-only features.  
2. **User-delegated JWT / SSO** — embed UI as that user (RBAC/module matrix applies).  
3. **CRM bot key** — machine mail/assist paths (already used for live-caption / bot send).

### 7.3 Suggested SDK packages (product cut)

| Package | Contents | Wave |
|---|---|---|
| `@worktual/sdk-core` | Auth, tenant, HTTP client, webhooks verify | 0 |
| `@worktual/contacts` | Contact APIs + optional UI | 1 |
| `@worktual/lead-ai` | Enrich/score/assign/nurture/lifecycle APIs | 1 |
| `@worktual/inbox` | Sync/send + Inbox UI | 2 |
| `@worktual/sales` | Deals/quotes APIs + pipeline UI | 2 |
| `@worktual/assist` | Meeting Assist UI + caption/session APIs | 2 |
| `@worktual/coworker` | Chat shell + confirmable actions | 3 |
| `@worktual/finance` | Invoices + finance agents | 3 |
| `@worktual/notifications` | Bell UI + notify APIs | 1 |

---

## 8. Recommended packaging decisions (summary)

### Bundle into SDK (yes)

- Contacts/leads, companies, activities  
- Inbox + email AI (compose / auto-reply)  
- Lead pipeline AI (enrich → score → assign|nurture → lifecycle)  
- Deals / quotes / proposals (phased)  
- Meeting Assist + notetaker control plane  
- Notifications  
- Co-worker chat (scoped modules)  
- Metrics/analytics APIs (+ optional chat UI)

### UI + Backend

- Contacts, Inbox, Pipeline, Proposal/Quote editors, Assist panel, Co-worker, Notification bell, (optional) Finance list/detail

### Backend-only

- All proactive/cron agents, scoring/nurture jobs, webhooks, catalog search, presence/SIP (unless host wants dialer UI), Marketing/Service MS handoffs

### Do not expose as raw SDK yet

- Shared DB connections, Vexa/Whisper internals, full proposal corpus training, unconstrained MCP, call/meeting frozen stacks without explicit product ask

---

## 9. Open product questions (before locking the SDK)

1. **Identity:** Host user directory sync vs Worktual-only users?  
2. **Data residency:** Host DB + Worktual AI vs Worktual as system of record?  
3. **Business types:** SDK variants for B2B / B2C / B2B2C module sets?  
4. **Confirm UX:** Always HITL for coworker mutations in embedded mode?  
5. **Billing:** Per-agent run vs per-seat vs per-embed?

---

## 10. Next engineering steps

1. Publish OpenAPI for Wave-1 APIs (`contacts`, `lead-ai`, `notifications`).  
2. Extract embeddable React packages from `frontend/src/components/{contacts,inbox,meeting-assist}`.  
3. Stabilize Hub/A2A skill catalog already in `ai-service/app/a2a/catalog.py` as the public AI surface.  
4. Document webhook event catalog (`lead.assigned`, `invoice.overdue`, `meeting.assist.suggestion`, …).  
5. Add sandbox tenant + API keys for SaaS developer onboarding.

---

*Derived from Worktual CRM modules (`backend/src/config/modules.ts`), agent catalog (`docs/crm-agents-reference.md`), and A2A Hub skills (`ai-service/app/a2a/catalog.py`).*
