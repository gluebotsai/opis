# Worktual Contact Centre — SDK Product Features

**Audience:** Product, platform, and partner engineering teams planning a **developer SDK** for SaaS companies that want Worktual AI contact-centre capabilities inside their own applications.

**Status:** Planning / inventory (derived from the current `ai_contact_centre` monorepo and architecture docs).

**Related:**

- [AI Contact Centre Plan](./AI_CONTACT_CENTER_PLAN.md)
- [Omnichannel Architecture Contract](./architecture/README.md)
- [Contact Center DB ontology](./ccaas/CONTACT_CENTER_DB_ONTOLOGY.md)
- [NLP agents & tools](./nlp/CONTACT_CENTER_AGENTS.md)
- [A2A integration](./A2A_INTEGRATION_AND_AGENT_CARD.md)
- [Webchat widget handoff](./chatservice/webchat_widget.md)
- [Chat Service API](./chatservice/API.md)
- [Copilot backend (SSE)](./nlp-backend/COPILOT_BACKEND_SSE.md)

---

## 1. Purpose

We are building an SDK so **SaaS vendors** can embed Worktual’s omnichannel contact centre and AI without rebuilding routing, bots, agent workspace, or NLP orchestration.

The SDK will offer:

| Delivery mode | What the integrator gets | Typical consumer |
|---------------|--------------------------|------------------|
| **UI + backend bundle** | Drop-in React (or Web Component) widgets + hosted APIs | Product teams wanting fast time-to-market |
| **Backend-only** | REST, SSE, WebSocket, and A2A skill APIs | Teams with custom UI who need AI + operations logic |
| **Hybrid** | Headless APIs + optional thin UI primitives (tokens, layout) | Design-system–first SaaS apps |

**Target users:** Developers at SaaS companies integrating AI-assisted support, sales chat, voice, or workforce tooling into an existing product shell.

**Non-goals for v1 SDK:** Full replacement of the Worktual Admin portal, self-hosted multi-tenant Postgres in the customer’s VPC (unless offered as a separate enterprise tier), or direct frontend access to Kafka, Redis, or raw NLP infrastructure.

---

## 2. Platform map (what the SDK wraps)

Today the product is a set of deployable services. The SDK is a **facade** over these boundaries:

| Layer | Service | Role in SDK |
|-------|---------|-------------|
| Agent / admin UI | `apps/web` | Source for extractable React SDK components |
| Control plane | `apps/cc-core` | Conversations, queues, routing, Socket.IO, copilot proxy |
| Tenant setup | `apps/platform-service` | Org, users, teams (often via My Accounts) |
| Webchat / email | `apps/chat-service` | Customer widget WebSocket + HTTP |
| Voice | `apps/call-service` | SIP, voicebot, recordings |
| Social | `apps/social-service` | WhatsApp, Instagram, Facebook |
| AI | `apps/nlp` | Bots, copilot, sentiment, summaries, analytics agents |
| Hub protocol | `apps/a2a-server` | A2A Agent Card + OAuth + skill invocation |

Shared TypeScript building blocks already in-repo: `@ai-contact-center/shared-types`, `@ai-contact-center/event-contracts`, `@ai-contact-center/platform-client`.

---

## 3. Features eligible for the SDK

Everything below is **in scope** for packaging. Maturity varies (some are production paths in this repo; others are roadmap items called out in product docs).

### 3.1 Omnichannel customer engagement

| Feature | Description |
|---------|-------------|
| **Webchat widget** | Embeddable launcher, prechat/consent, bot + live-agent handoff |
| **Email automation** | Inbound ingest, bot draft/reply, priority, queue routing |
| **WhatsApp / social messaging** | Meta webhooks, templates, session messaging |
| **SMS** (where channel enabled) | Same conversation model as other async channels |
| **Voice** | Inbound/outbound, queue routing, voicebot, recording playback |
| **Proactive webchat** | Server-triggered popup / welcome for known visitors |
| **Outbound voice bot call** | Campaign-triggered automated voice conversation |

### 3.2 Conversation operations (agent / supervisor)

| Feature | Description |
|---------|-------------|
| **Unified inbox / workspace** | Multi-channel conversation list, filters, assignment views |
| **Reply & channel actions** | Send message, transfer, disposition, wrap-up |
| **Customer 360 panel** | Profile, timeline, notes (CRM data via integrator APIs) |
| **Live monitoring** | Queues, agents, active conversations, SLA signals |
| **Tasks & callbacks** | Follow-ups, scheduled callbacks, proactive recovery |
| **Internal team chat** | Agent-to-agent rooms (not customer-facing) |
| **Contacts (CDP)** | List, read, create, update, enrich, merge (approval-gated) |

### 3.3 Workforce & configuration (scoped for SDK)

| Feature | Description |
|---------|-------------|
| **Queues & membership** | List queues, eligibility, add/remove agents |
| **Presence** | Agent availability states for routing |
| **Channel automation policies** | Bot on/off, confidence thresholds, live-agent rules |
| **Routing profiles** | Org-level routing and recording settings (read/configure via API) |

*Note:* Full **Setup Workspace** (branding, channel OAuth, billing) may remain in Worktual My Accounts; the SDK exposes **runtime IDs** (`webchat_id`, `organizationId`, API keys) that link to that setup.

### 3.4 Analytics & reporting

| Feature | Description |
|---------|-------------|
| **Dashboard KPIs** | Queue volume, SLA, channel mix |
| **Semantic / ontology analytics** | Natural-language questions over metrics |
| **Executive / agent performance reports** | Generated summaries and charts |
| **Diagnostic review & workforce planning** | NLP-assisted operational recommendations |
| **Anomaly investigation** | Composite read across analytics + live monitoring |

### 3.5 Integration & extensibility

| Feature | Description |
|---------|-------------|
| **A2A skills** | Machine-discoverable skills for hub or custom orchestrators |
| **Event contracts** | Normalized conversation lifecycle events (for customer webhooks) |
| **CRM / ticketing handoff** | Super-agent coordination; data fetched from integrator systems |

---

## 4. UI + backend bundles (recommended SDK packages)

These features benefit from **opinionated UI** tied to real-time state (Socket.IO) and consistent UX. Package as versioned npm modules (e.g. `@worktual/cc-widget`, `@worktual/cc-agent-workspace`) that authenticate against Worktual-hosted APIs.

| SDK module (proposed) | UI surface | Backend dependency | Priority |
|----------------------|------------|-------------------|----------|
| **Customer Chat Widget** | Launcher, chat window, prechat form, typing indicators | `chat-service` (WS) + `nlp` bot turns + `cc-core` routing | P0 |
| **Agent Workspace Shell** | 3-panel inbox, conversation thread, reply composer | `cc-core` REST + Socket.IO | P0 |
| **Copilot Panel** | Embedded assistant chat, tool progress, confirmations | `nlp` SSE (`/api/v1/copilot/*`) via `cc-core` gateway | P0 |
| **Customer 360 Panel** | Profile, interaction history, notes | `cc-core` + CDP; CRM fields via integrator proxy | P1 |
| **Live Monitoring Dashboard** | Queues, agents, conversation drill-down | `cc-core` monitoring APIs + Socket.IO | P1 |
| **Tasks / Callbacks Inbox** | Task list, due dates, assignment | `cc-core` task APIs | P1 |
| **Contacts UI** | Search, detail, enrich flows | `cc-core` / CDP APIs | P2 |
| **Performance / Dashboard widgets** | KPI cards, charts, copilot hooks | `cc-core` analytics + `nlp` reports | P2 |
| **Internal Chat** | Team rooms sidebar | `cc-core` internal-chat | P3 |
| **Voice softphone strip** | Call controls, presence (WebRTC/SIP) | `call-service` + `cc-core` | P3 (higher integration cost) |

### 4.1 UI bundle integration pattern

```text
Integrator app (React / Vue / etc.)
  │
  ├─ npm: @worktual/cc-widget
  │     props: { webchatId, apiBaseUrl, theme?, visitorId? }
  │     └── loads branding from My Accounts public config API
  │
  ├─ npm: @worktual/cc-agent-workspace
  │     props: { accessToken, organizationId, surface: 'agent' | 'admin' }
  │     └── Socket.IO + REST to cc-core (never to nlp/kafka directly)
  │
  └─ Optional: CSS variables / design tokens from @worktual/cc-theme
```

**Authentication:** OAuth2 / OIDC for human agents; **publishable keys** or short-lived session tokens for the customer widget (scoped to `webchat_id` + visitor).

**Theming:** Webchat already defines a `personalisation` JSON contract ([webchat_widget.md](./chatservice/webchat_widget.md)); SDK components should consume the same shape.

---

## 5. Backend-only SDK surfaces

Use when the SaaS product **already has UI** but needs Worktual logic, AI, or telephony.

| Capability | API style | Entry points (current / planned) |
|------------|-----------|----------------------------------|
| **Omnichannel bot turn** | REST | `nlp`: `/api/v1/webchat/turn`, `whatsapp/turn`, `social/turn`, `email/turn` |
| **Email priority / automation** | REST | `nlp`: `/api/v1/email/priority` |
| **Agent copilot** | REST + SSE | `nlp`: `/api/v1/copilot`, `/stream`, `/suggest-reply/stream` |
| **Wrap-up & follow-up AI** | REST | `nlp`: `/api/v1/workspace/wrap-up/suggest`, `follow-up/extract` |
| **Sentiment** | REST | `nlp`: `/api/v1/workspace/sentiment/turn`, `sentiment/session` |
| **Contact entity extraction** | REST | `nlp`: `/api/v1/contact-entities/extract` |
| **Omnichannel summary refresh** | REST | `nlp`: `/api/v1/omnichannel/summary/refresh` |
| **Voice queue routing AI** | REST | `nlp`: `/api/v1/voice-routing/select-queue` |
| **Proactive callback planning** | REST | `nlp`: `/api/v1/proactive/missed-callback/plan` |
| **Supervisor attention insight** | REST | `nlp`: `/api/v1/supervisor/agent-attention-insight` |
| **Dashboard analytics agents** | REST | `nlp`: `/api/v1/dashboard-analytics/*` |
| **Executive / agent reports** | REST | `nlp`: `/api/v1/reports/*` |
| **Conversation CRUD & lifecycle** | REST | `cc-core` conversation, assignment, disposition routes |
| **Queues, presence, monitoring** | REST | `cc-core` workforce + monitoring routes |
| **Webchat session (headless)** | WebSocket + REST | `chat-service` ([API.md](./chatservice/API.md)) |
| **Channel message ingest (custom UI)** | Internal/event | Integrator backend → Worktual message ingest contracts |
| **A2A skills** | JSON-RPC + OAuth | `a2a-server` Agent Card ([A2A doc](./A2A_INTEGRATION_AND_AGENT_CARD.md)) |

### 5.1 Backend-only integration pattern

```text
Integrator backend                          Worktual
      │                                        │
      ├─ Service account (client credentials) ─┼─► cc-core / nlp (tenant-scoped)
      │
      ├─ User-delegated token (agent SSO) ─────┼─► cc-core (agent APIs)
      │
      └─ Server-side only ─────────────────────┼─► A2A skills (Hub or custom orchestrator)
```

**Rule (from architecture):** Customer browsers talk to `chat-service` / `cc-core` only. **Never** expose `nlp`, Kafka, or Redis to end-user clients; the SDK server SDK or BFF proxies AI calls.

---

## 6. AI capabilities for the SDK

Grouped by product agent domain ([CONTACT_CENTER_AGENTS.md](./nlp/CONTACT_CENTER_AGENTS.md)).

| AI capability | Runtime | SDK exposure | UI bundle? | Backend-only? |
|---------------|---------|--------------|------------|---------------|
| **Omnichannel support bot** | `support_bot`, custom Lola | Widget + channel adapters | Yes (widget) | Yes (turn APIs) |
| **Agent copilot (multi-specialist)** | Coworker router + inbox/contact/task/queue/analytics/monitoring | Copilot panel | Yes | Yes (SSE) |
| **Suggested reply** | Copilot | Workspace composer assist | Yes | Yes |
| **Conversation summary / wrap-up** | Workspace + omnichannel summary | Workspace + disposition dialogs | Yes | Yes |
| **Follow-up extraction** | Workspace NLP | Tasks inbox | Optional | Yes |
| **Sentiment (turn / session)** | Sentiment service | Monitoring alerts, workspace badges | Optional | Yes |
| **Contact enrich / entity extract** | support_bot / contact tools | Customer 360 | Optional | Yes |
| **Email priority & auto-send policy** | Email bot | — | No | Yes |
| **Voice queue selection** | Voice routing agent | — | No | Yes |
| **Proactive missed-callback plan** | Proactive agent | Callback sweeper / tasks | No | Yes |
| **Semantic analytics Q&A** | Analytics specialist | Dashboard + copilot | Yes | Yes |
| **Ontology / root-cause** | Analytics (internal steps) | Anomaly investigate | Partial | Yes (A2A composite) |
| **Executive & performance narratives** | Reports APIs | Reports UI | Optional | Yes |
| **Agent attention insight** | Supervisor API | Monitoring | Optional | Yes |
| **Diagnostic review / forecast / WFM plan** | Dashboard analytics | Admin dashboards | Optional | Yes |

**Compliance:** Actions that mutate data (create contact, add queue agent, send template, etc.) should flow through **policy + approval** ([compliance knowledge layer](./WORKTUAL_COMPLIANCE_KNOWLEDGE_LAYER_ARCHITECTURE.md)). The SDK documents which AI tools are read-only vs write vs approval-gated.

---

## 7. Customer data & database access by feature

Worktual uses PostgreSQL schemas **`accounts`** (setup), **`ccass`** (runtime), **`cdp`** (customer profile). Integrators typically **do not** get raw DB access; the SDK documents **logical data** required and **APIs** used.

| Feature / SDK module | Worktual data (read) | Worktual data (write) | Integrator data required |
|----------------------|----------------------|------------------------|---------------------------|
| **Webchat widget** | `accounts.setup_webchat_configs`, channel policy, `ccass` sessions/messages | Messages, session state, conversation lifecycle | Optional: `visitorId`, page context, signed user id from SaaS |
| **Support bot** | Knowledge base (tenant), conversation history, channel policy | Bot messages, handoff flags | Product catalog FAQ, optional CRM id for personalization |
| **Email channel** | Email config, thread ids, policies | Messages, outbox | Mailbox OAuth or forwarding setup (My Accounts) |
| **WhatsApp / social** | Social config, templates | Messages, template sends | Meta / channel credentials (My Accounts) |
| **Voice** | DIDs, routing profile, queues | CDR, recordings metadata | Customer phone numbers, consent flags |
| **Agent workspace** | Conversations, messages, assignments, dispositions | Replies, transfers, notes, disposition | — |
| **Customer 360** | `cdp.customer_profile`, `cdp.identity_keys`, `cdp.interactions` | Notes, enrich fields | **CRM API** (tickets, orders, subscription) via integrator-supplied connectors or webhooks |
| **Contacts SDK** | CDP profiles | Create/update/merge (gated) | External id mapping (`externalCustomerId`) |
| **Queues / WFM APIs** | `ccass.queues`, `ccass.agents`, presence | Queue membership changes (gated) | SaaS user id ↔ `setup_users` mapping |
| **Monitoring** | Live snapshots, SLA state | — | — |
| **Tasks / callbacks** | `ccass.agent_tasks` | Task create/assign/complete | Preferred callback channel, timezone |
| **Analytics / reports** | Aggregated metrics tables / semantic layer | Report artifacts (stored) | Optional business unit dimensions from SaaS |
| **Copilot** | Context for current `surface` (page, selected conversation) | Tool side-effects per tool | Page metadata, selected record ids from host app |
| **A2A skills** | Per skill (contacts, inbox, queues, …) | Per skill scopes | `organizationId`, Hub policy tokens |

### 7.1 Minimum tenant provisioning (integrator checklist)

1. **Organization** created in Worktual / My Accounts.
2. **Channel** configured (webchat_id, email, social, or voice).
3. **Queues & agents** published (`accounts` setup → `ccass` runtime).
4. **API credentials** issued (OAuth client, widget key, or SSO).
5. **Optional:** CDP seed or sync webhook for contacts; CRM proxy URL for Customer 360.

### 7.2 Data residency & PII

- Message content, recordings, and profiles are **tenant-isolated** (`organization_id` / RLS patterns in `cc-core`).
- SDK docs must state **what is logged**, retention, and whether integrators may pass **end-customer PII** in bot context (recommended: pseudonymous `visitorId` + explicit enrich step).

---

## 8. How SaaS developers integrate each feature

| Goal | Integration approach | SDK artifact |
|------|---------------------|--------------|
| Add chat to marketing site | Embed script or React widget; pass `webchatId` | `@worktual/cc-widget` |
| Support bot only (custom chat UI) | WS/HTTP to `chat-service` + POST bot turns to proxied NLP | `@worktual/cc-chat-headless` + server SDK |
| Embed agent inbox in SaaS app | iframe or React workspace; SSO token | `@worktual/cc-agent-workspace` |
| Add AI assistant to existing admin UI | Mount copilot panel; set `CopilotPageProvider` surface | `@worktual/cc-copilot` |
| Automate ops from their product backend | Service account → REST/A2A | `@worktual/cc-server` (typed client) |
| React to conversation events | Register webhook; verify signatures | `@worktual/cc-events` (Zod schemas from `event-contracts`) |
| Enterprise hub orchestration | Register A2A Agent Card URL | OAuth + JSON-RPC client |
| Sync customers | Periodic CDP upsert API or batch import | Documented idempotent contact APIs |

### 8.1 Example: webchat embed (UI + backend)

1. Customer enables Web Chat in My Accounts → receives `webchat_id` and embed snippet.
2. SaaS app installs `@worktual/cc-widget` or loads hosted `widget.js`.
3. Widget fetches **public config** (branding, greeting) from Accounts API.
4. Session opens on `chat-service` WebSocket; bot turns route through `nlp`; handoff creates `ccass.conversations` and agent Socket.IO events.

### 8.2 Example: copilot in custom CRM (backend-heavy)

1. SaaS backend obtains service token with `cc.conversation.read` (or user token).
2. Frontend calls **their** BFF → `POST /copilot/stream` with `context.surface = 'inbox'` and `conversationId`.
3. SSE events stream tool progress; write tools require user confirmation in UI (mirror `suggest-reply/confirm` patterns).

### 8.3 Example: headless “AI support API”

1. Integrator POSTs customer message + `channel` + `threadId` to documented turn endpoint.
2. Response includes bot reply, confidence, `handoffRecommended`.
3. Integrator UI renders reply; on handoff, integrator calls conversation assign API or displays queue position from `cc-core`.

---

## 9. A2A skills as backend SDK catalog

Published skills on the Contact Centre Agent Card ([`catalog.py`](../apps/a2a-server/src/cc_a2a/catalog.py)) are a **machine-readable backend SDK** for orchestrators:

| Skill ID | Domain | Risk |
|----------|--------|------|
| `cc.contact.list` / `read` / `create` / `update` / `status.update` / `enrich` | Interaction operations | read / reversible write |
| `cc.conversation.context.read` | Agent assist | read |
| `cc.queue.list` / `agent-eligibility.read` / `agent.add` / `agent.remove` | Workforce | read / reversible write |
| `cc.agent.presence.read` | Workforce | read |
| `cc.monitoring.callback-channels.read` / `cc.callback.create` | Workforce / monitoring | read / write |
| `cc.analytics.query` | Performance | read |
| `cc.anomaly.investigate` | Performance (composite) | read |
| `cc.webchat.proactive-engagement.trigger` | Omnichannel | write |
| `cc.voice.auto-bot-call.trigger` | Omnichannel | write |

Integrators building **their own** agent orchestration should prefer A2A when they need discovery, OAuth scopes, and policy boundaries—not ad-hoc REST.

---

## 10. Suggested SDK repository layout (future)

```text
packages/
  sdk-core/           # Auth, tenant context, retries, tracing
  sdk-types/          # Re-export shared-types + OpenAPI-generated clients
  sdk-react/          # Widget, workspace, copilot, monitoring
  sdk-node/           # Server-side helpers (webhook verify, token exchange)
  sdk-events/         # event-contracts re-exports + webhook handlers
docs/
  SDK_PRODUCT_FEATURES.md   # This document
  SDK_QUICKSTART.md           # To be written: keys, first widget, first API call
```

---

## 11. Out of scope or deferred for SDK v1

| Item | Reason |
|------|--------|
| Full My Accounts Setup UI | Stays in Worktual; SDK consumes resulting IDs |
| Billing, reseller, partner portals | Platform concern |
| Direct Kafka / CDC consumers | Internal ops only |
| UI-only actions without API (`navigate`, draft staging) | Excluded from A2A; not stable SDK |
| Self-serve telephony PSTN provisioning | Requires regulated carrier setup |
| Guaranteed on-prem NLP model weights | Hosted AI default; private LLM is enterprise add-on |

See also [DEFERRED_ENTERPRISE_WORK.md](./ccaas/DEFERRED_ENTERPRISE_WORK.md).

---

## 12. Summary matrix

| Category | UI + backend bundle | Backend-only |
|----------|---------------------|--------------|
| Customer messaging | Webchat widget | Bot turn APIs, chat-service WS |
| Agent productivity | Workspace, copilot, suggest reply | Copilot SSE, wrap-up, follow-up |
| Workforce | Monitoring dashboards (optional) | Queues, presence, A2A queue skills |
| Customer data | Customer 360 panel | CDP + contact CRUD/enrich APIs |
| Channels | — | Email, social, voice service APIs |
| Analytics | Dashboard widgets | Reports, semantic query, anomaly investigate |
| Orchestration | — | A2A Agent Card skills |
| Realtime | Widget + workspace Socket.IO | Server webhooks + integrator Socket.IO client to cc-core |

---

## 13. Next documentation steps

1. **SDK_QUICKSTART.md** — API keys, sandbox tenant, first widget embed, first copilot call.
2. **OpenAPI bundles** — Aggregate `cc-core`, `chat-service`, `nlp` public routes per SDK module.
3. **Scope matrix per pricing tier** — Which skills and channels are enabled per plan.
4. **Reference app** — Minimal Next.js sample using widget + agent workspace + SSO.

---

*Document owner: Contact Centre platform team. Update when new NLP routes, A2A skills, or extractable UI modules ship.*
