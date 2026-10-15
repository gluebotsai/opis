# Worktual Ontology — Architecture & Agent Context Guide

This document explains **what the Worktual ontology is**, **how it is stored**, **how it is layered** (core → industry → enterprise), and **what each agent receives** as context — including types, relations, actions, taxonomy, metrics, and rules.

---

## 1. What the ontology is built about

The Worktual ontology is a **deterministic, module-composed type system** for a multi-spoke B2B SaaS platform. It gives every LLM agent in the MAS (Multi-Agent System) a **minimal, policy-safe vocabulary** for understanding the business domain — without exposing the full knowledge graph, SQL, warehouse schemas, or live customer rows.

**Ontology id:** `wt:cc` (Worktual Contact Center + Ticketing, extended to CRM, Campaign, Hub, CDP)

**Products (spokes):**

| Product | Agent prefix | Business domain |
|---------|--------------|-----------------|
| Contact Centre (CCaaS) | `cc.*` | Conversations, queues, WFM, AI support bots, reporting |
| Ticketing | `tk.*` | Tickets, teams, KB, macros, admin, proactive/ASGA |
| CRM | `crm.*` | Accounts, deals, quotes, orders, activities |
| Campaign | `camp.*` | Campaigns, templates, delivery, attribution |
| Hub | `hub.*` | Cross-spoke orchestration (dispatch, spoke-query, pipelines) |
| CDP | — | Customer spine, identity keys, profile resolution |

**What it explains to an agent:**

- **Types** — what business objects exist (`wt:Customer`, `wt:Ticket`, `wt:Deal`, …)
- **Relations** — how objects connect (`Ticket --FOR_CUSTOMER--> Customer`)
- **Actions** — what the agent is allowed to *do* (`create_ticket`, `handoff`, `ask_semantic`)
- **Taxonomy** — controlled vocabulary for classification (`intent`, `ticket.priority`, `deal.stage`)
- **Metrics** — certified KPI **ids** the agent may request via `ask_semantic` (formulas live elsewhere)
- **Rules** — guardrails (“do not invent FAQ”, “ticket actions require identityResolved”)

**What it deliberately does *not* include:**

- Live instance data (customer names, ticket numbers, deal amounts)
- MetricFlow SQL or dbt model definitions
- Full module YAML dumps or `pack.to_dict()` JSON
- MCP tool field schemas (those live on tool definitions)

**Design principles that make this work:**

1. **One canonical type per concept** — e.g. a single `wt:Ticket` across CC and Ticketing; industry packs change *labels*, not ids.
2. **Legal slice vs prompt slice** — the full module union validates tools/policy; only an allowlisted subset goes into the LLM prompt.
3. **Deterministic composition** — modules + presets + tenant overlay; no GraphRAG or dynamic module picking at runtime.
4. **Separation of concerns** — ontology = vocabulary + policy; semantic layer = numbers; CDP/tools = facts.

---

## 2. Storage format and directory layout

Everything is **YAML**, version-controlled in Git, compiled at fetch time by `ontology/slice.py`.

```
ontology/
├── catalog.yml           # Module registry, 40+ agent presets, hub entitlements, prompt allowlists
├── taxonomy.yml          # SKOS-style classification axes and terms
├── agents.yml            # Production agent id → preset + owned_product
├── metric_policies.yml   # Compact metric guidance (when / not_for / dims / scope)
├── slice.py              # Compiler: fetch_ontology_slice() → as_prompt()
├── modules/              # 33 domain modules — classes, relations, actions, metric_ids
│   ├── core.yml          # Foundation (always included)
│   ├── ticket.yml, interaction.yml, crm_deal.yml, hub.yml, …
│   └── metrics_*.yml     # Certified MetricFlow id lists per product
├── industry/             # Industry overlay packs
│   ├── generic.yml
│   ├── saas_b2b.yml
│   ├── healthcare.yml, bfsi.yml, ecommerce.yml
└── slices/               # Precompiled legal slices (debug/policy — NOT the LLM prompt)

tenants/
└── org{id}/
    └── semantic.yaml     # Enterprise / tenant overlay (labels, binds, synonyms, policies)

semantic/
├── metric_registry.yml   # Certified metric id → MetricFlow source mapping
└── dbt/                  # Metric formulas (dbt + MetricFlow semantic models)
```

**API delivery:**

```http
POST /v1/ontology/slice    # Spokes — requires product
POST /v1/ontology/hub      # Hub — requires products[]
```

Default response field: **`prompt`** — a plain-text block injected into the agent system context each turn (or cached until deploy).

---

## 3. The three layers: Core, Industry, Enterprise

The ontology uses a **three-tier overlay model**. Each tier answers a different question.

| Layer | Question it answers | Where stored | Changes per… |
|-------|---------------------|--------------|------------|
| **Core** | What exists in Worktual regardless of vertical? | `ontology/modules/*.yml` + `taxonomy.yml` | Product release (platform team) |
| **Industry** | How does this vertical *talk about* the same things? | `ontology/industry/*.yml` | Industry pack selection |
| **Enterprise** | How does *this tenant* name, bind, and govern data? | `tenants/org{id}/semantic.yaml` | Customer onboarding / admin |

### 3.1 Core — the universal spine

**Purpose:** Define **stable, industry-neutral** type ids that never fork per customer.

**Stored as:** Module YAML files under `ontology/modules/`. The `core` module is **always included** (unless explicitly disabled). Other modules declare `depends_on` and are unioned when an agent preset loads them.

**Example — foundation class (`ontology/modules/core.yml`):**

```yaml
module: core
layer: foundation

classes:
  - id: wt:Customer
    extends: wt:Party
    definition: Party the tenant does business with. Canonical type for Patient/Client/Buyer.
    properties: [cdpId, lifecycleStage]
    classified_by: [lifecycle]
    relations:
      hasConsent: wt:Consent
      identifiedBy: wt:Identity
      belongsToOrg: wt:Organization

  - id: wt:Channel
    definition: Communication medium. Values come from taxonomy.channel.
    classified_by: [channel]
```

**Example — domain module (`ontology/modules/ticket.yml`):**

```yaml
module: ticket
layer: domain
depends_on: [core, identity]
owned_by_spoke: ticketing
readable_by: [contact_centre, hub]

classes:
  - id: wt:Ticket
    extends: wt:WorkItem
    definition: Support case — customer issue with priority, team, L1 agent and L2 resolver.
    properties: [number, subject, description, category, channel]
    classified_by: [ticket.priority, ticket.category, ticket.status, channel]
    relations:
      customer: wt:Customer
      assignedL1: wt:Employee
      resolverL2: wt:Employee

relations:
  - { from: wt:Ticket, type: FOR_CUSTOMER, to: wt:Customer }
  - { from: wt:Customer, type: HAS, to: wt:Ticket }

actions:
  - id: wt:action.create_ticket
    operates_on: [wt:Ticket]
    requires: [identityResolved]
```

**What core gives you:**

- Shared vocabulary across all spokes (`wt:Customer`, `wt:Organization`, `wt:Consent`)
- Cross-spoke relations that Hub and CC can both rely on
- Actions with **preconditions** (`requires: identityResolved`) agents must honor
- Classes marked `prompt: false` stay in the legal slice for validation but are hidden from compact prompts unless explicitly allowlisted

**Why this matters:** Without core, every spoke would invent its own “Customer” or “Ticket” type. Hub orchestration, CDP identity resolution, and cross-product analytics would break. Core is the **lingua franca**.

---

### 3.2 Industry — vertical language without forking types

**Purpose:** Adapt **labels**, **extra properties**, and **taxonomy terms** for a vertical — **without creating new core class ids**.

**Stored as:** Pack files in `ontology/industry/`, selected by `industryPack` (default `generic`; overridden by tenant config).

**Example — SaaS B2B pack (`ontology/industry/saas_b2b.yml`):**

```yaml
pack: saas_b2b
extends_ontology: wt:cc
businessTypes: [b2b, b2b2c]

labels:
  wt:Customer: Account
  wt:Ticket: Case
  wt:Appointment: Demo
  wt:Organization: Workspace

extends:
  wt:Customer:
    additional_properties: [productInterest, companySize, workspaceId]
  wt:Ticket:
    additional_properties: [affectedSpoke, skillId]

taxonomy_adds:
  intent:
    - trial_question
    - seat_expansion
    - integration_help
  ticket.category:
    - hub_a2a
    - crm_mcp
    - campaign_whatsapp
```

**What industry changes:**

| Field | Effect on agent context |
|-------|-------------------------|
| `labels` | Header line: `wt:Customer shown as Account` — agent uses tenant-appropriate words in replies |
| `extends.additional_properties` | Legal slice knows extra fields exist; tools/CDP supply values |
| `taxonomy_adds` | New allowed term ids merged into taxonomy section of prompt |
| `modules` | Optional extra modules (usually empty — types come from product modules) |

**What industry does *not* change:**

- Class ids (`wt:Customer` stays `wt:Customer`)
- Metric formulas
- Which actions an agent may invoke (that is preset-driven)

**Why this matters:** A healthcare tenant sees “Patient”; a SaaS tenant sees “Account”; a B2B demo tenant sees “Prospect” — but **every system integration still keys on `wt:Customer`**. You get vertical fluency without N duplicate ontologies.

---

### 3.3 Enterprise — tenant-specific naming, binding, and policy

**Purpose:** Capture **this organization’s** vocabulary, data bindings, metric thresholds, consent rules, and enabled spokes.

**Stored as:** `tenants/org{id}/semantic.yaml` where `{id}` matches `accounts.organizations.id`.

**Example — org1000 (`tenants/org1000/semantic.yaml`):**

```yaml
tenantId: org1000
organizationId: 1000
industryPack: saas_b2b
businessType: b2b
enabledSpokes: [contact_centre, ticketing, crm, campaign, hub, cdp]

labels:
  wt:Customer: Prospect      # wins over industry label "Account"
  wt:Ticket: Case
  wt:Appointment: Demo

synonyms:
  Account: wt:Customer
  Logo: wt:Customer
  Case: wt:Ticket
  AHT: average_handle_time
  urgent cases: high_priority_open_tickets_metric

binds:
  wt:Customer:
    live: GET /cdp/v1/profiles/{cdpId}
    warehouse: cdp.customer_profile
    join: { organization: organization_id }
  wt:Ticket:
    live: GET /ticketing/v1/tickets?cdpId={cdpId}&status=open
    warehouse: mart_tickets

metrics:
  high_priority_open_tickets_metric:
    threshold: { warn: 1, critical: 2 }
  sla_breach_rate:
    threshold: { warn_percent: 5, critical_percent: 10 }

policies:
  contactWindow: { hours: 9, start: "09:00", end: "18:00", timezone: Asia/Kolkata }
```

**What enterprise overlay contributes to the agent prompt:**

| Field | In `as_prompt()`? | Used by |
|-------|-------------------|---------|
| `industryPack` | Indirectly (selects industry pack) | slice.py |
| `labels` | **Yes** — header `labels:` line | Agent natural language |
| `extra_modules` | Yes — appended to module list | Legal + prompt slice |
| `synonyms` | No (runtime NL → id mapping) | Router / intent layer |
| `binds` | No | Semantic layer, tools, MCP |
| `extensions` | No | Warehouse field mapping |
| `metrics.threshold` | No | Alerting / dashboards |
| `policies` | No | Runtime enforcement |

**Label precedence:** `tenant labels` **override** `industry labels` **override** default definitions.

For org1000: industry says `wt:Customer → Account`, tenant says `Prospect` → agent prompt shows **Prospect**.

**Why this matters:** Enterprise layer separates **platform truth** (core ids) from **customer reality** (how Acme Corp talks, which APIs hold their data, what “urgent” means for their SLA policy). Agents sound like the tenant’s product; engineers keep one canonical model.

---

### 3.4 How the three layers compose (the difference that matters)

```
┌─────────────────────────────────────────────────────────────┐
│  ENTERPRISE  tenants/org1000/semantic.yaml                  │
│  "Prospect" not "Account"; binds to mart_tickets; thresholds│
├─────────────────────────────────────────────────────────────┤
│  INDUSTRY    ontology/industry/saas_b2b.yml                 │
│  Account/Case/Demo labels; trial_question intent terms      │
├─────────────────────────────────────────────────────────────┤
│  CORE        ontology/modules/*.yml + taxonomy.yml          │
│  wt:Customer, wt:Ticket, wt:Deal — universal ids & relations│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    fetch_ontology_slice()
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
        LEGAL SLICE                      PROMPT SLICE
   (full module union)              (preset allowlist, compact)
   tool validation                  injected into LLM each turn
```

**The great difference in practice:**

| Without layering | With Worktual layering |
|------------------|------------------------|
| 5 products × 4 industries × 1000 tenants = combinatorial YAML forks | 33 modules + 5 industry packs + 1 file per tenant |
| Agent prompts include irrelevant types from other spokes | Preset allowlist → 400–800 tokens, role-specific |
| “Customer” means different things in CRM vs CC vs Hub | One `wt:Customer`, labels adapt per tenant |
| Metrics and SQL leak into prompts | Metric **ids** + when/not_for hints only |
| Hub sees everything or nothing | Hub entitlement plan merges only **purchased** SKUs |

---

## 4. Taxonomy — controlled vocabulary in context

Taxonomy is **not** a class hierarchy. It is a set of **named axes** with **term ids** — SKOS-style classification trees in `ontology/taxonomy.yml`.

**Example axes:**

```yaml
taxonomies:
  channel:
    classified_classes: [wt:Interaction, wt:Callback]
    terms: [voice, web, email, whatsapp, instagram, facebook, social, push]

  intent:
    classified_classes: [wt:Interaction]
    terms: [billing_dispute, status_request, sales, booking, live_agent_request, …]

  ticket.priority:
    classified_classes: [wt:Ticket]
    terms: [P1, P2, P3]

  ticket.status:
    classified_classes: [wt:Ticket]
    terms: [open, pending, escalated, resolved, closed, reopened]

  deal.stage:
    classified_classes: [wt:Deal]
    terms: [prospect, qualified, proposal, won, lost]

  hub.scenario:
    classified_classes: [wt:HubRequest]
    terms: [spoke_query, ops_anomaly, customer_event, dispatch]
```

**How taxonomy enters agent context:**

1. Each agent **preset** lists allowed axes in `prompt.taxonomy`.
2. `slice.py` collects terms for those axes from `taxonomy.yml`.
3. Industry `taxonomy_adds` merge extra terms (e.g. `trial_question` on `intent` for SaaS).
4. Rendered under **Taxonomy (use these term ids)** in the prompt.

**Why agents need taxonomy in context:**

- Prevents inventing priority values (“urgent” vs canonical `P1`)
- Ensures intent classification uses routable term ids
- Aligns NL from customers (“WhatsApp”) with `channel: whatsapp`
- Hub scenarios use `hub.scenario` terms for dispatch routing

---

## 5. What each agent receives — the prompt slice

### 5.1 Selection pipeline

```python
from ontology.slice import fetch_ontology_slice

pack = fetch_ontology_slice(
    agent="crm.deals",      # from ontology/agents.yml
    tenant="org1000",       # → tenants/org1000/semantic.yaml
    product="crm",          # origin SKU (spokes only)
)
context = pack.as_prompt()  # inject this string every turn
```

**Steps inside `fetch_ontology_slice`:**

1. Load tenant YAML → `industryPack`, `extra_modules`, `labels`
2. Resolve agent → preset + modules from `agents.yml` / `catalog.yml`
3. Validate `product` matches agent’s `owned_product`
4. Expand module dependencies; always include `core`
5. Union classes, relations, actions, metric_ids from all modules
6. Apply industry overlay (labels, property extends, taxonomy_adds)
7. Merge tenant labels (highest precedence)
8. Filter through **preset.prompt allowlist** → compact view
9. Render `as_prompt()` text

### 5.2 Preset allowlist — what controls the prompt

Each preset in `catalog.yml` defines both **modules** (legal slice) and **prompt** (LLM slice):

```yaml
cc.ai_support:
  agent: AI Support Agent
  level: L3
  modules: [core, identity, interaction, knowledge, ticket]
  prompt:
    classes: [wt:Customer, wt:Contact, wt:Consent, wt:Conversation,
              wt:Intent, wt:KnowledgeArticle, wt:Ticket]
    actions: [identify, contact_enrich, get_organization_details,
              get_organization_knowledge, create_ticket, get_ticket_status, handoff]
    taxonomy: [channel, intent, knowledge.module]
    metrics: [high_priority_open_tickets_metric]
    relations_only_if_both_ends_in_classes: true
    rules:
      - Do not invent FAQ; one knowledge.module per turn.
      - Ticket actions require identityResolved.
```

**Compact prompt sections:**

| Section | Source | Purpose for agent |
|---------|--------|-------------------|
| Header | version, modules, agent name, labels | Scope + tenant vocabulary |
| Types | allowlisted classes | What objects exist in *this role* |
| Relations | filtered edges | Valid object graph for reasoning |
| Actions | allowlisted actions + `requires` | Tool boundaries |
| Metrics | allowlisted ids + `metric_policies.yml` | When to use `ask_semantic` |
| Taxonomy | allowlisted axes + terms | Classification vocabulary |
| Route | `route_table` (L1/L2 supers only) | Which specialist to delegate to |
| Rules | preset rules + defaults | Anti-hallucination guardrails |

### 5.3 How this helps the agent understand its business role

An agent’s **role** is encoded in four coupled dimensions:

1. **Level (L1 / L2 / L3 / platform)** — Super agents route; L3 executors perform field workflows; Hub orchestrates cross-spoke.
2. **Module set** — Which domain concepts exist in the legal slice (e.g. deals agent gets `crm_deal`, not `tk_macro`).
3. **Prompt allowlist** — Which concepts appear in the LLM context (narrower than legal slice).
4. **Rules + route_table** — Behavioral contract (“route to tk.tickets; do not collect ticket fields yourself”).

**Example role differentiation:**

| Agent | Sees types | Primary actions | Does NOT do |
|-------|------------|-----------------|-------------|
| `cc.ai_support` | Conversation, Ticket, KnowledgeArticle | FAQ, create_ticket, handoff | Queue admin, deals, campaigns |
| `crm.deals` | Deal, Quote, CrmActivity | create_deal, update_deal_stage | Ticket lifecycle, CC routing |
| `tk.super` | Ticket, Team, HubRequest | route_to_specialist | Field-level ticket create (delegates to tk.tickets) |
| `hub.orchestrator` | HubRequest, DispatchAction | spoke_query, dispatch | Customer-facing replies |

The ontology **teaches the agent its job boundaries** before any user message arrives. It is the difference between a general LLM and a **role-conditioned business agent**.

---

## 6. Hub vs Spoke context

### Spoke agents

- Endpoint: `POST /v1/ontology/slice`
- Parameter: `product` (single origin SKU)
- Context: one preset’s allowlist for that product
- Customer-facing: yes (bots, portals, coworker UIs)

### Hub agent

- Endpoint: `POST /v1/ontology/hub`
- Parameter: `products[]` — **exact purchased SKUs** (no auto-expansion)
- Context: `hub_entitlements.spine_modules` + per-product `hub_modules` + merged prompt allowlists
- Customer-facing: **no** — `suggestedAgentReply` only; dispatches to spokes

**Hub entitlement plan (`catalog.yml`):**

```yaml
hub_entitlements:
  spine_modules: [hub, core, cdp, identity]
  base_prompt:
    classes: [wt:Customer, wt:Consent, wt:HubRequest, wt:Strategy, wt:DispatchAction]
    actions: [spoke_query, run_pipeline, dispatch, callback]
    taxonomy: [hub.scenario, channel, anomaly.severity]
  products:
    contact_centre:
      hub_modules: [interaction, followup, performance, compliance]
      prompt:
        classes: [wt:Interaction, wt:Callback, wt:Anomaly]
        metrics: [missed_contact_rate]
    ticketing:
      hub_modules: [ticket]
      prompt:
        classes: [wt:Ticket]
        actions: [create_ticket]
        metrics: [open_tickets_metric, high_priority_open_tickets_metric]
    crm:
      hub_modules: [crm_account, crm_deal]
      prompt:
        classes: [wt:Deal, wt:Account]
        taxonomy: [deal.stage]
```

If a tenant bought CC + CRM but not Campaign, Hub **must not** see campaign types or metrics — entitlement prevents scope creep and token bloat.

---

## 7. Metrics in ontology context

Metric **formulas** live in `semantic/dbt/` (MetricFlow). The ontology prompt lists **ids only**, enriched by `ontology/metric_policies.yml`:

```yaml
won_deal_rate:
  label: Win Rate
  on: wt:Deal
  dims: [stage, owner_name, owner_team_id]
  when: Period or owner win rate — not this deal's stage.
  not_for: Single deal fields — use deal tools.
  via: ask_semantic
  scope: owner_or_team
```

**Rendered in prompt:**

```
Metrics (ask_semantic; ids only; do not invent SQL)
- won_deal_rate (Win Rate) on wt:Deal  group_by/filter: stage, owner_name, owner_team_id
  when: Period or owner win rate — not this deal's stage.  |  not: Single deal fields — use deal record.
```

This teaches agents **when** to call semantic query vs **when** to use record-level tools — a common failure mode without policy hints.

---

## 8. Full examples

### 8.1 Stored format — agent registry entry

`ontology/agents.yml`:

```yaml
agents:
  cc.ai_support:
    owned_product: contact_centre
    preset: cc.ai_support
  crm.deals:
    owned_product: crm
    preset: crm.deals
  hub.orchestrator:
    owned_product: hub
    preset: hub.orchestrator
```

### 8.2 Stored format — CRM deals preset

`ontology/catalog.yml`:

```yaml
crm.deals:
  agent: Deal Agent
  level: L3
  modules: [cdp, crm_deal, crm_quote, crm_activity]
  prompt:
    classes: [wt:Customer, wt:Contact, wt:Account, wt:Deal, wt:Quote, wt:CrmActivity]
    actions: [create_deal, update_deal_stage, log_activity]
    taxonomy: [deal.stage]
    metrics: [open_pipeline_value, won_deal_rate, deal_volume]
```

### 8.3 Rendered context — CC AI Support (org1000)

Fetched via `fetch_ontology_slice(agent="cc.ai_support", tenant="org1000", product="ccaas")`:

```
Ontology (this agent — use only these types and actions)
version: 2026.09.3  modules: core, identity, interaction, knowledge, ticket
agent: AI Support Agent
labels: wt:Customer shown as Prospect, wt:Contact shown as Contact, wt:Ticket shown as Case

Types
- wt:Customer: Party the tenant does business with. Canonical type for Patient/Client/Buyer.
- wt:Consent: Permission to process, record, or contact on a scope.
- wt:Contact: Named person record in CC contact book (may resolve to Customer).
- wt:Conversation: Threaded messaging or voice session in inbox / bot.
- wt:Intent: Classified reason for the turn or session.
- wt:KnowledgeArticle: Retrievable org/product/support content. Agents must not invent beyond this.
- wt:Ticket: Support case — customer issue with priority, team, L1 agent and L2…

Relations
- wt:Customer --HAS_CONSENT--> wt:Consent
- wt:Contact --RESOLVES_TO--> wt:Customer
- wt:Conversation --HAS_INTENT--> wt:Intent
- wt:Ticket --FOR_CUSTOMER--> wt:Customer
- wt:Customer --HAS--> wt:Ticket

Actions (only these; honor requires)
- wt:action.identify
- wt:action.contact_enrich
- wt:action.handoff requires: customerRequestedOrPolicy
- wt:action.get_organization_details
- wt:action.get_organization_knowledge
- wt:action.create_ticket requires: identityResolved
- wt:action.get_ticket_status requires: identityResolved

Metrics (ask_semantic; ids only; do not invent SQL)
- high_priority_open_tickets_metric (High-Priority Open Tickets)  group_by/filter: priority, queue_name
  when: Count urgent/P1 open tickets for dispatch or escalation.  |  not: One ticket priority — use ticket record.

Taxonomy (use these term ids)
- channel: voice, web, email, whatsapp, instagram, facebook, social, push
- intent: billing_dispute, status_request, sales, booking, cancel, how_to, complaint, …
- knowledge.module: business, product, support, sales, service

Rules
- Do not invent FAQ; one knowledge.module per turn.
- No queue, presence, logout, navigate, deals, or campaigns.
- Handoff only when customer asks or accepts.
- Ticket actions require identityResolved.
```

### 8.4 Rendered context — Ticketing Super (route table excerpt)

L1 super agents include a **Route** section from `prompt.route_table`:

```
Route
- Create / reassign / escalate ticket → tk.tickets
- Teams → tk.teams
- Add customer / missing CDP → tk.customers
- KB article / category → tk.kb
- Canned reply → tk.macros
- Priority / status setup → tk.admin
- Cross-spoke → hub.orchestrator

Rules
- Route to an L3 specialist; do not run their field workflows.
- Confirm-to-save is the specialist's job, not Super's.
```

This is how ontology encodes **organizational structure** — not just data types, but **who does what** in the agent mesh.

---

## 9. Legal slice vs prompt slice (critical distinction)

| | Legal slice | Prompt slice |
|---|-------------|--------------|
| **Definition** | Union of all modules + dependencies + core | Filtered by `preset.prompt` allowlist |
| **Size** | Large (full domain model) | Small (400–800 tokens target for L3) |
| **Used for** | Tool validation, policy engines, `ontology/slices/*.yml` debug artifacts | LLM system context via `as_prompt()` |
| **Includes properties** | Yes (full YAML) | No — short one-line definitions only |
| **Includes taxonomy** | All axes referenced by classes | Only `prompt.taxonomy` axes |

**Never inject** `pack.to_dict()`, raw module YAML, or verbose mode into production agent hot paths. Verbose exists for admin debugging only.

---

## 10. Relationship to semantic layer

| Concern | Ontology | Semantic layer |
|---------|----------|----------------|
| KPI definitions | Metric **id** + when/not_for | MetricFlow YAML + dbt marts |
| Query execution | — | `POST /v1/semantic/query` |
| Row scope | `scope: owner_or_team` in metric policy | `semantic/scope.py` from setup_users |
| Agent asks “win rate by stage” | Knows id `won_deal_rate`, dims `[stage]` | Validates allowlist, runs MetricFlow |

The ontology tells the agent **which questions are valid**; the semantic layer returns **numbers**.

---

## 11. Quick reference — key files

| File | Role |
|------|------|
| `ontology/catalog.yml` | Modules, presets, hub entitlements |
| `ontology/agents.yml` | Production agent index |
| `ontology/taxonomy.yml` | Classification axes |
| `ontology/modules/*.yml` | Core + domain types/actions |
| `ontology/industry/*.yml` | Vertical overlays |
| `ontology/metric_policies.yml` | Metric prompt hints |
| `ontology/slice.py` | Compiler |
| `tenants/org{id}/semantic.yaml` | Enterprise overlay |
| `semantic/metric_registry.yml` | Certified metric ids |

---

## 12. Fetching context (HTTP)

```bash
# CC AI Support bot
curl -s -X POST http://localhost:8765/v1/ontology/slice \
  -H 'Content-Type: application/json' \
  -d '{"organizationId": 1000, "agent": "cc.ai_support", "product": "ccaas"}'

# CRM deals agent
curl -s -X POST http://localhost:8765/v1/ontology/slice \
  -H 'Content-Type: application/json' \
  -d '{"organizationId": 1000, "agent": "crm.deals", "product": "crm"}'

# Hub with entitled products
curl -s -X POST http://localhost:8765/v1/ontology/hub \
  -H 'Content-Type: application/json' \
  -d '{"organizationId": 1000, "products": ["contact_centre", "ticketing", "crm"]}'
```

Response (default):

```json
{
  "organizationId": 1000,
  "tenant": "org1000",
  "version": "2026.09.3",
  "prompt": "Ontology (this agent — use only these types and actions)\n..."
}
```

Inject `prompt` into the agent system block. Cache per `(organizationId, agent, product)` until ontology deploy version changes.

---

*Generated for the Worktual ontology & semantic layer repository. For spoke integration steps see [README.md](../../README.md); for API details see [api/README.md](../../api/README.md).*
