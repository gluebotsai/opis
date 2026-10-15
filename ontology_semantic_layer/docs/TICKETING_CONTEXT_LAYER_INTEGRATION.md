# Ticketing ↔ Context Layer integration

**Audience:** Ticketing Cursor / engineers wiring MAS agents to Worktual Context Layer  
**Service:** Context Layer HTTP API (default `http://<host>:8765`, service version `1.2.0`)  
**Product string on every spoke call:** `"ticketing"`  
**Do not call MetricFlow, dbt, or Postgres from Ticketing agents.**

This document is the contract. Implement against it. Do not invent new `tk.*` ids, metric formulas, or SQL.

**Last updated:** 2026-09-17 — **Ontology:** per-agent `tk.*` presets for all 31 harness workers; proactive ids fail-closed (see §2, §6). **Semantic:** **96** certified ticketing metrics, **96** SQL templates (1:1), full grants on reporting executors; industrial thresholds; mart-aligned validator (see §3). **SQL:** reporting via `analytics_audit_query_executor` + `insights_analytics_executor` only; SQL Super in `sql_agent/` (see §4).

---

## 0. What you are building

Ticketing already has Super → Domain → Executor (plus proactive workers). Context Layer does **not** replace Express, MCP, RBAC, or confirm-to-save.

**Agent registry (Context Layer):** 31 harness runtime ids + compact aliases (`tk.super`, `tk.reporting`, `tk.portal`). Proactive codes (`tiaa`, `dssa`, …) are **not** registered — always use the bound harness executor id for slice, semantic, and SQL.

You add **three spoke HTTP calls** (plus optional admin/discovery):

| User need | Who calls | Endpoint | What comes back |
|---|---|---|---|
| “What may this agent talk about?” | Every LLM worker, once per session / entitlement change | `POST /v1/ontology/slice` | `prompt` (+ `metrics[]` when `userId` is set) to inject into **that** agent’s system prompt |
| “How many / what rate / what average?” | **Only** analytics workers | `POST /v1/semantic/query` | Certified KPI number(s) in `rows` + `status` / `threshold` |
| “Show / list / search ticket rows (or notes / audit)” | Ticket lifecycle workers | `POST /v1/sql/query` | Read-only **rows** from ticketing marts |

The **staff user never talks to Context Layer**. The agent understands the utterance using the slice already in its prompt, then calls the right endpoint with **structured fields** — not the user’s raw sentence on semantic (SQL `instruction` is agent-authored NL for **row** tasks only).

```
User utterance
  → Ticketing Super (route)
    → Domain (pick Executor + Skill)
      → Executor
           ├─ append slice.prompt (already injected)
           ├─ writes → Express / MCP (unchanged)
           ├─ how-many / rate / SLA% / CSAT → remount analytics → POST /v1/semantic/query
           └─ list / show / search rows → POST /v1/sql/query
```

### 0.1 Same endpoints as CCaaS — different Ticketing purpose

Hub and every spoke share **one** Context Layer. URL paths are identical; **behavior is scoped by `product` / `originProduct` and agent policy**.

| Concern | CCaaS (example) | Ticketing (this doc) |
|---|---|---|
| Product field | `"contact_centre"` / `"ccaas"` | **`"ticketing"`** always |
| Slice selector | `agent: "cc.reporting"` etc. | `agent: "ticket_lifecycle_executor"` etc. |
| Semantic grain | Conversations, AHT, containment | Tickets, resolution, CSAT, SLA |
| SQL default mart | `mart_conversations` | **`mart_tickets`** |
| SQL list-only agents | `cc.ai_support`, `cc.coworker` | **`ticket_lifecycle_executor`**, **`ticket_creation_executor`** — KPI/count phrasing → 400 `kpi_not_allowed` |
| SQL presets (server) | `cc.conversations`, `cc.queue`, … | **`tk.tickets`**, **`tk.notes`**, **`tk.audit`**, **`tk.queue`** (Gemma picks from catalog — **not** the retired ontology preset `tk.tickets`) |
| Ontology presets | `cc.reporting`, `cc.super`, … | **One `tk.*` preset per harness worker** (e.g. `tk.ticket_lifecycle_executor`) — see §2.5 |
| KPI on SQL path | Reporting agents may use `metricRequest` fallback | **Lifecycle agents blocked** — use semantic for certified numbers |
| Shared metric names | `sla_breach_rate`, `resolution_rate` | **Different formulas** — must use `product: "ticketing"` |

**Non-contradiction rule:** Both products call `POST /v1/sql/query`, but for Ticketing lifecycle workers that endpoint means **retrieve ticket-shaped rows** via SQL presets (§4.3), not certified dashboard KPIs. Certified numbers always go through `POST /v1/semantic/query` on a **reporting** worker (or SQL `metricRequest` only as an explicit fallback after semantic 503).

---

## 1. Hard rules (fail these and the API will 400/403)

1. **`agent` / `originAgent` is this worker’s runtime id** as registered in Context Layer (`ontology/agents.yml`). Example: `ticket_lifecycle_executor`.  
   **Never** send a human agent name or proactive code (`tiaa`, `dssa`, …).  
   **Never** borrow another worker’s id — each harness executor has its own `tk.*` preset (see §2.5).
2. **`product` / `originProduct` is always `"ticketing"`** for ticket KPIs and ticket rows. `"contact_centre"` / `"ccaas"` will reject or mis-route ticket metrics.
3. **`organizationId` + `userId`** are required on semantic and SQL. For Ticketing, **`userId` is `ticketing.agents.id`** (not `accounts.setup_users.id`). Same id on semantic and SQL. Pass `userId` on slice too so `metrics[]` is packed for that role. Other products (CCaaS, CRM, …) still use MyAccount `setup_users.id`.
4. **Certified KPIs → semantic (reporting agents). Ticket rows → SQL (lifecycle agents).** Do not use lifecycle SQL to answer “how many open tickets?” — Super remounts analytics. Context Layer **rejects** KPI/count phrasing on list-only agents with **`kpi_not_allowed`** (HTTP 400).
5. **Writes stay on Express.** Context Layer is read-only.
6. **Unknown runtime id → 400 `Unknown agent`.** If production uses a name not in §6, stop and ask Context Layer to register it in `ontology/agents.yml` + `POST /v1/admin/reload`.
7. **`asga` is not an LLM.** Do not call slice / semantic / SQL for ASGA.
8. **Org must be entitled to ticketing SKU** — slice and semantic return **403** if the org has no ticketing entitlement.

---

## 2. Ontology — `POST /v1/ontology/slice`

Ontology answers: **what types, actions, taxonomy terms, and metric NAMES this agent may use.**

It does **not** hold live tickets, SQL, or KPI formulas.

### 2.1 Request

```http
POST /v1/ontology/slice
Content-Type: application/json
```

```json
{
  "organizationId": 1000,
  "userId": 42,
  "product": "ticketing",
  "agent": "ticket_lifecycle_executor",
  "format": "prompt"
}
```

| Field | Required | Notes |
|---|---|---|
| `organizationId` | yes | Tenant |
| `userId` | recommended | When set, response includes role-scoped `metrics[]` and `entitlements` |
| `product` | yes | **`"ticketing"`** |
| `agent` **or** `preset` **or** `modules` | exactly one | Prefer **`agent`** (runtime id) |
| `format` | no | `prompt` (default), `debug`, `verbose`, `json` |

- Do not use this endpoint for Hub (`hub.orchestrator` → `POST /v1/ontology/hub`).
- `format: "verbose"` — full legal types/actions for admin/debug; **do not** inject every turn.
- `format: "json"` — full compiled slice object for tooling.

### 2.2 Response (what to do with it)

| Field | Use |
|---|---|
| `prompt` | **Data-only ontology YAML** — append to this worker’s system prompt. Contains `entities`, `relations`, `synonyms`, `taxonomy`, `business_rules`. **No** actions, routing, or `wt:*` ids. Cache until deploy / entitlement change / admin reload. |
| `metrics` | When `userId` was sent: `{ id, label, dims, … }` this agent may use for **semantic** query. Returned **outside** the YAML `prompt`. Empty for most Ticketing workers. |
| `entitlements` | SKUs, channels, features for this org |
| `role` | Packed from `userId` |
| `version`, `industryPack`, `tenant` | Metadata for cache keys |

The LLM must only mention types/actions/metric ids from this slice. It must not invent ids or SQL.

### 2.3 When to fetch

| When | Action |
|---|---|
| Worker process starts / agent definition loads | Fetch slice for **that** runtime id |
| Org SKU / channel entitlement changes | Refresh |
| Context Layer YAML deploy (`POST /v1/admin/reload`) | Refresh |
| Every user turn | **Do not** refetch unless cache miss |

Inject **per worker**. Super’s prompt is not the lifecycle executor’s prompt.

### 2.4 Per-agent slices (31 harness workers)

Each of the **31 harness workers** (1 Super + 5 Domains + 25 Executors) has its own `tk.*` preset in `ontology/presets/ticketing.yml`. You still send **each worker’s own runtime id** on `agent=`; Context Layer maps it via `ontology/agents.yml`.

| Layer | Count | Ontology shape (`prompt` YAML) | `metrics[]` on response |
|---|---:|---|---|
| Super | 1 | Full ticketing **graph** (all nodes from `ontology/graph_nodes.yml`) | Empty |
| Domain | 5 | Graph entity subset for that domain’s data scope | Empty |
| Executor | 25 | Graph entity subset for that worker’s data scope | Empty (except 2 reporting executors — headline subset) |
| Portal | 1 | Customer-facing ticket + KB graph entities | Empty |

**Registered compact aliases (not extra harness workers):** `tk.super`, `tk.reporting` (→ `tk.analytics_audit_query_executor` preset), `tk.portal`.

**Do not** send proactive ids (`tiaa`, `dssa`, `icpa`, …) to slice — they are **not** in `ontology/agents.yml`. Unknown id → HTTP 400. Proactive workers execute through their bound harness executor; use that executor’s runtime id for slice (e.g. `insights_analytics_executor`, not `tiaa`).

### 2.5 Runtime id → preset map (ontology)

Preset id = `tk.` + harness name (Super keeps `tk.super`). Full per-preset types/actions: [TICKETING_AGENTS_ONTOLOGY.md](TICKETING_AGENTS_ONTOLOGY.md).

| Runtime `agent=` | Preset | Ontology focus |
|---|---|---|
| `ticketing_super_agent` | `tk.super` | Route table, all types (full), specialist catalog |
| `intake_deflection_domain` | `tk.intake_deflection_domain` | Ticket, Customer, KnowledgeArticle — plan intake/deflect |
| `triage_routing_domain` | `tk.triage_routing_domain` | Ticket, Team, Employee — plan classify/assign/workload |
| `resolution_lifecycle_domain` | `tk.resolution_lifecycle_domain` | Ticket, TicketNote, Team — plan existing-ticket work |
| `knowledge_domain` | `tk.knowledge_domain` | Ticket, KnowledgeArticle — plan KB assist |
| `catalog_administration_domain` | `tk.catalog_administration_domain` | Team, KB, Macro, Customer, HubRequest — plan catalog/admin |
| `ticket_creation_executor` | `tk.ticket_creation_executor` | Create pipeline: identify, create_ticket, enrich |
| `ticket_lifecycle_executor` | `tk.ticket_lifecycle_executor` | List/update/reassign/escalate/resolve (rows via SQL) |
| `ai_resolution_executor` | `tk.ai_resolution_executor` | KB deflect — read-only knowledge actions |
| `classification_priority_executor` | `tk.classification_priority_executor` | Classify/enrich — no assign |
| `intelligent_assignment_executor` | `tk.intelligent_assignment_executor` | Reassign L1/L2 |
| `workload_optimization_executor` | `tk.workload_optimization_executor` | Read workload signals only |
| `root_cause_learning_executor` | `tk.root_cause_learning_executor` | `ask_ontology` only (graph learning) |
| `sla_escalation_executor` | `tk.sla_escalation_executor` | SLA escalate |
| `investigation_summary_executor` | `tk.investigation_summary_executor` | Read-only ticket/note context |
| `customer_reply_drafting_executor` | `tk.customer_reply_drafting_executor` | Draft reply/note |
| `autonomous_resolution_executor` | `tk.autonomous_resolution_executor` | Resolve/reopen status only |
| `resolution_quality_executor` | `tk.resolution_quality_executor` | Read/flag quality |
| `personalized_notification_executor` | `tk.personalized_notification_executor` | Notify staff |
| `insights_analytics_executor` | `tk.insights_analytics_executor` | Insights Skill — semantic + graph actions + headline metrics |
| `resolution_knowledge_executor` | `tk.resolution_knowledge_executor` | Recommend KB for ticket |
| `similar_ticket_detection_executor` | `tk.similar_ticket_detection_executor` | Similar-ticket search |
| `team_queue_crud_executor` | `tk.team_queue_crud_executor` | Team/queue CRUD |
| `kb_quality_crud_executor` | `tk.kb_quality_crud_executor` | KB authoring CRUD |
| `macro_crud_executor` | `tk.macro_crud_executor` | Macro CRUD |
| `customer_directory_crud_executor` | `tk.customer_directory_crud_executor` | Customer read/360 |
| `priority_status_crud_executor` | `tk.priority_status_crud_executor` | Priority/status catalog |
| `org_settings_integrations_executor` | `tk.org_settings_integrations_executor` | Org prefs, Hub delegate |
| `notification_inbox_executor` | `tk.notification_inbox_executor` | Inbox read/mark |
| `analytics_audit_query_executor` | `tk.analytics_audit_query_executor` | Analytics/audit Skill — semantic + graph + headline metrics |
| `automation_rule_crud_executor` | `tk.automation_rule_crud_executor` | Automation rule CRUD |
| `tk.portal` | `tk.portal` | Customer portal surface |

### 2.6 What changed (per-agent ontology rollout)

**Before:** Many harness executors shared a few dump presets (`tk.tickets`, `tk.proactive`, `tk.teams`, `tk.kb`, `tk.macros`, `tk.customers`, `tk.admin`). Proactive codes (`tiaa`, `dssa`, …) were registered and received the same slice as their twin.

**After:**

1. **One preset per harness worker** — 31 distinct `tk.*` presets with role-specific type/action allowlists and rules aligned to the hierarchy MD (`docs/ticketing-agents-hierarchy-and-ontology.md`).
2. **Proactive ids removed** from `ontology/agents.yml` — slice fails closed for `tiaa`, `dssa`, `tcaa`, etc.
3. **Shared specialist presets retired** from the agent registry — `tk.tickets`, `tk.proactive`, `tk.teams`, `tk.kb`, `tk.macros`, `tk.customers`, `tk.admin` are no longer attached to runtime ids (preset YAML may remain unused).
4. **Super** — unchanged behavior: `full_ontology`, `include_module_index`, `include_specialist_catalog`, `metrics_mode: none`. Specialist catalog lists Domains + Executors; reporting executor presets are excluded from “delegate writes”.
5. **Reporting split** — `analytics_audit_query_executor` and `insights_analytics_executor` each have their own preset (distinct rules for audit vs insights Skills). Compact alias `tk.reporting` points at the analytics-audit preset.

**Source files:** `ontology/presets/ticketing.yml`, `ontology/agents.yml`. Regenerate metric grants after agent changes: `python3 scripts/generate_agent_metrics.py`.

### 2.7 Full ontology reference (optional)

For a static copy-paste block (all types + 95 metrics), see `docs/TICKETING_ONTOLOGY_FULL_PROMPT.txt`. Runtime should still prefer live slice from the API.

Per-agent prompt examples and ontology scope: [TICKETING_AGENTS_ONTOLOGY.md](TICKETING_AGENTS_ONTOLOGY.md).

---

## 3. Semantic — `POST /v1/semantic/query`

Semantic answers: **the certified number** for metric id(s), for this org / user / product.

Gateway: certify id → agent allowlist → allowed dimensions → row scope → execute (template fast path **or** MetricFlow).

### 3.1 Who may call it (Ticketing)

**Only these two harness executors** (presets `tk.analytics_audit_query_executor` and `tk.insights_analytics_executor`):

| Runtime `agent=` | Preset | Typical Skill |
|---|---|---|
| `analytics_audit_query_executor` | `tk.analytics_audit_query_executor` | `analytics-query`, `csat-report`, `audit-query`, dashboard reads |
| `insights_analytics_executor` | `tk.insights_analytics_executor` | `analytics-generate-insights` (scheduled/chat insights) |

Compact alias `tk.reporting` maps to the analytics-audit preset for slice callers that still use `agent: "tk.reporting"`.

**Not entitled:** all other harness workers, Domains, Super, portal, proactive codes (`tiaa`, `dssa`, …). They get `metrics: []` on slice; semantic calls return HTTP 400. Super must **remount** an analytics executor for “how many…”.

Reporting executors may query the **full certified ticketing catalog** on the API (**96 ids** — same set granted to `analytics_audit_query_executor` and `insights_analytics_executor`). The slice `prompt` exposes a **headline subset (12 ids)** for the LLM; other ids are valid on the API if certified and allowlisted.

| Runtime `agent=` | Semantic grant size | Slice headlines |
|---|---:|---|
| `analytics_audit_query_executor` | 96 | 12 (§3.6) |
| `insights_analytics_executor` | 96 | 12 (same set) |
| `tk.reporting` (compact alias) | 96 | 12 (maps to analytics-audit preset) |

### 3.2 Request

```http
POST /v1/semantic/query
Content-Type: application/json
```

```json
{
  "organizationId": 1000,
  "userId": 1005,
  "product": "ticketing",
  "agent": "analytics_audit_query_executor",
  "metrics": ["open_tickets_metric"],
  "group_by": ["queue_name"],
  "filters": [
    { "dimension": "priority", "op": "in", "values": ["high", "urgent"] }
  ],
  "time": { "start": "2026-08-01", "end": "2026-09-01", "grain": "day" },
  "limit": 50
}
```

| Field | Required | Notes |
|---|---|---|
| `organizationId`, `userId` | yes | Tenant + **`ticketing.agents.id`** (spoke PK; not MyAccount id) |
| `dataScope` | no | Ticketing only: `"org"` (admin default) or `"mine"` for personal KPIs |
| `product` | yes | **`"ticketing"`** |
| `agent` | yes | **This worker’s runtime id** |
| `metrics` | yes | Certified ids. `minItems: 1`. **Not** NL |
| `group_by` | no | Must be on metric allowlist (`queue_name`, `priority`, `status`, `channel`, …) |
| `filters` | no | `{ "dimension", "op", "values" }` |
| `time` | no | `start`/`end`, `grain`, or `period` (`last_7_days`, `this_quarter`, …) |
| `limit` | no | 1–500, default 50 |

**Do not send** a natural-language `query` / `instruction` field.

### 3.3 Response (client shape)

Success body is **shaped for agents** (no raw SQL in the response):

```json
{
  "rows": [{ "open_tickets_metric": 42 }],
  "status": "ok",
  "threshold": null
}
```

Multi-metric: `status` and `threshold` may be objects keyed by metric id. `status` / `threshold` come from `semantic/metric_thresholds.yml` (industry bands + org overlays — regen via `scripts/generate_metric_thresholds.py`). Server logs include `path`, `prepare_ms`, `compile_ms`, `warehouse_ms` — integrators should not depend on those fields in the JSON body.

### 3.4 Execution paths (server-side — you do not choose)

Gateway order on every request: **certify id → agent allowlist → allowed dimensions → row scope → execute**.

For simple scalar queries (no `group_by`, no `time.grain`, no user filters), semantic answers via **pre-approved SQL templates** (`semantic/sql/metric_templates/ticketing.yml` — **96 templates**, one per certified ticketing metric; mirrored in `semantic/metrics/ticketing.yml`). Same formulas as dbt/MetricFlow.

Otherwise semantic compiles **MetricFlow** (`path: mf_compile` or cached SQL).

| Path | When | Ticketing note |
|---|---|---|
| `sql_template` | Scalar, no breakdown | Fast path; same certified definition as MF |
| `mf_compile` / cache | `group_by`, `time.grain`, filters | Trends, breakdowns, periods |

**Row scope (ticketing identity):** `userId` on semantic and SQL is always **`ticketing.agents.id`** for the tenant (`organizationId`). Never `accounts.setup_users.id`. Role comes from `ticketing.agents.role`. Implementation: [`semantic/scope.py`](../semantic/scope.py) (`_lookup_ticketing_agent_scope`), [`semantic/ticketing_scope.py`](../semantic/ticketing_scope.py), and request field `dataScope` (`org` | `mine`). Mapping doc: [ticketing-accounts-agent-scope.md](../ticketing_docs/ticketing-accounts-agent-scope.md).

| Role | Default semantic KPI scope | SQL list default |
|---|---|---|
| `admin`, `viewer` | **Org-wide** (no person filter) | Org-wide unless instruction says “my tickets” |
| `agent` | Personal (`assignee_id = userId`) | Personal assignee slice |
| `resolver` | Personal (`assignee_id` or `resolver_id = userId`) | Personal |

Admin personal KPIs: send `"dataScope": "mine"` or an `assignee_id` filter equal to `userId`. Other products (CCaaS, CRM) are unchanged — they still resolve `userId` via `accounts.setup_users`.

**This is not** the same as calling `POST /v1/sql/query` from a lifecycle agent. Template execution inside semantic still runs through certify + allowlist + scope. On MetricFlow **503**, reporting agents may use SQL `metricRequest` fallback (§4.5) — same template SQL, not lifecycle list SQL.

### 3.5 Multi-metric

Pass multiple ids in one request. Server tries one MetricFlow call; on incompatible models it **fan-outs** per metric and merges on shared `group_by` / time keys.

### 3.6 Headline metric ids (LLM prompt on reporting executors)

Headlines are packed into the compact slice for `analytics_audit_query_executor`, `insights_analytics_executor`, and alias `tk.reporting` (same headline set for all three).

| Id | Meaning |
|---|---|
| `open_tickets_metric` | Open ticket **snapshot** — do **not** use `time.grain` for open-count trends |
| `high_priority_ticket_volume` | High/urgent ticket volume (prefer over legacy `high_priority_open_tickets_metric`) |
| `ticket_volume` | Created in period |
| `tickets_created_today_metric` | Created today |
| `unassigned_tickets_metric` | Unassigned |
| `average_resolution_time_hours` | Mean hours to resolve |
| `average_csat_score` | Mean CSAT |
| `reopen_rate` | Reopen share |
| `resolution_sla_compliance_rate` | Resolution SLA met rate |
| `breached_tickets_metric` | SLA breached count |
| `current_overdue_tickets_metric` | Currently overdue |
| `due_today_tickets_metric` | Due today |

**Cross-product names:** `resolution_rate` and `sla_breach_rate` exist in CCaaS **and** ticketing with **different formulas**. Always `product: "ticketing"`. CCaaS uses `contact_centre` / `ccaas` — never mix product strings on the same metric id.

### 3.7 Errors

| HTTP | Meaning | Ticketing action |
|---|---|---|
| 400 | Validation / not entitled / bad metric or dimension | Fix ids; remount reporting worker |
| 403 | Org not entitled to product | Check SKU |
| 502 | Warehouse error | Retry / ops |
| 503 | MetricFlow unavailable | Optional: SQL `metricRequest` fallback (§4.5) |

503 body may include `validated` — prepared query that failed at compile/execute.

### 3.8 “Why / drivers”

After a number, **do not** use slice or semantic for root-cause narrative. Use Ticketing’s existing KG / `ask_ontology` (reports) path if you have it. Slice ≠ knowledge graph.

### 3.9 Validation & ops (semantic layer — Context Layer repo)

Integrators do **not** run these from Ticketing agents; ops / CI use them after registry, template, or dbt changes.

| Script | Purpose |
|---|---|
| `scripts/validate_ticketing_core_metrics.py` | **10 core KPIs** — API vs Postgres `ticketing_marts.mart_tickets` (MF-aligned ground truth, `assignee_or_team` scope). Report: `scripts/ticketing_core_metrics_report.json` |
| `scripts/validate_ticketing_core_sql_metrics.py` | Same 10 metrics via `POST /v1/sql/query` `metricRequest` fallback path |
| `scripts/test_ticketing_agent_matrix.py` | Allow/deny matrix — reporting executors 200, lifecycle/super/proactive 400 |
| `scripts/test_ticketing_semantic_matrix.py` | Optional exhaustive semantic + fallback matrix (all 96 ids) |
| `scripts/compile_sql_catalog.py --product ticketing` | Regen `semantic/catalog/compiled/ticketing.yml` after dbt mart changes |
| `scripts/dbt_run_all.py --select ticketing` | Rebuild `ticketing_marts.*` views before validation |

**Example (core semantic validation):**

```bash
API_BASE=http://127.0.0.1:8765 ORG=1000 USER_ID=1001 PYTHONPATH=. python3 scripts/validate_ticketing_core_metrics.py
```

**Source of truth for ticketing KPIs:** certified definitions in `semantic/dbt/ticketing/default/dbt/models/semantic_layer/semantic_layer.yml` + `semantic/sql/metric_templates/ticketing.yml`. Validator compares API output to **mart** SQL aligned to those measures (not raw `ticketing.*` source tables).

After YAML or template edits: `POST /v1/admin/reload` (or restart API) before expecting Ticketing to see new metric ids or grants.

---

## 4. SQL Super — `POST /v1/sql/query`

SQL Super answers: **rows** (list, search, notes, audit, queues). Read-only. Catalog-allowlisted tables only. Org filter and row scope injected server-side.

**Implementation:** Execution is in the isolated **`sql_agent/`** package (not MetricFlow / semantic query). Ticketing agents **never** send table names or SQL — only an **instruction the agent wrote** plus `entityHint`.

### 4.0 Architecture (server-side — do not replicate in Ticketing)

```
POST /v1/sql/query
  → execute_sql_query()              [sql_agent/super.py]
    → plan_sql_query()                 Gemma JSON plan (no SQL in plan)
    → execute_plan()                   orchestrator + harness guardrails
      → ticketing executor             sql_agent/executors/ticketing.py
        → Postgres ticketing_marts.*
```

| Stage | Role |
|---|---|
| **Gemma Super planner** | Maps `instruction` → `{ intent, preset_id, product, table?, filters?, limit }`. Preset must come from the ticketing `preset_catalog` payload — never CCaaS presets when `originProduct: "ticketing"`. |
| **Harness** | Fail-closed on unknown table/column, SQL in plan, preset allowlist violations. Aligns `product` from preset. May coerce a wrong table to the preset default (warning in `_meta.warnings`). |
| **Executor** | Parameterized SELECT; injects `organization_id`, row scope (`assignee_id` on `mart_tickets`), entitled channels. |
| **Compiled catalog** | `sql_agent/catalog/compiled/ticketing.yml` — allowlisted tables/columns from live warehouse introspection. Regenerate via `scripts/compile_sql_catalog.py`. |
| **API** | Shapes client `rows`; maps typed errors to HTTP **400/503** (catalog/plan/policy/warehouse shape — not opaque 500). |

Cross-product presets require entitlement; otherwise the planner realigns to the origin product default SQL preset (`tk.tickets` — the **SQL** preset id for `mart_tickets`, not the retired ontology agent `tk.tickets`).

### 4.1 Ticketing purpose vs CCaaS (same URL)

| Mode | `_meta.source` | Ticketing use |
|---|---|---|
| `sql_list` | Default for lifecycle | **Primary path** — ticket / note / audit / queue rows |
| `metric_fallback` | `metricRequest` set | After semantic 503 only (reporting agents) |
| `sql_count` | Plain count heuristics | Avoid from Ticketing — route KPIs to semantic |

**List-only policy** (runtime agents `ticket_lifecycle_executor`, `ticket_creation_executor`):

- Instructions that match **named KPIs** (`how many open tickets`, `CSAT`, `SLA breach rate`, …) or bare **count / volume / how many** phrasing → **HTTP 400** `{ "detail": { "code": "kpi_not_allowed", "message": "…route to reporting agent…" } }`.
- Instructions with **list / show / search** verbs (without count intent) → row list via the appropriate SQL preset (§4.3).

This mirrors CCaaS `cc.ai_support` / `cc.coworker` list-only behavior; only the mart and entity differ.

On success, check `_meta.warnings` for server-side table coercion (e.g. `coerced_table:mart_audit_events→mart_tickets`).

### 4.2 Who may call it for lists

| Runtime `originAgent=` | SQL list | Notes |
|---|---|---|
| `ticket_lifecycle_executor` | **Yes** | Primary ticket row retrieval |
| `ticket_creation_executor` | **Yes** | Search/duplicate lists only; create stays Express |
| `analytics_audit_query_executor` | `metricRequest` only | After semantic 503; may also use `sql_list` for drill-down rows |
| `insights_analytics_executor` | `metricRequest` only | same |

`similar_ticket_detection_executor`: prefer MCP list tools; optional SQL with `entityHint: "wt:Ticket"` for similar **rows**, not similarity **counts**.

### 4.3 Ticketing SQL presets & marts (server-routed)

Gemma picks a **SQL preset id** from `sql_agent/presets/catalog.yml`. Schema is always `ticketing_marts` (from compiled catalog).

> **Naming note:** SQL preset `tk.tickets` routes queries to `mart_tickets`. This is **unrelated** to the retired **ontology** agent/preset `tk.tickets` (removed from `ontology/agents.yml`). Lifecycle workers use runtime id `ticket_lifecycle_executor` / ontology preset `tk.ticket_lifecycle_executor`.

| SQL preset id | Instruction intent | Default table | Typical columns returned |
|---|---|---|---|
| `tk.tickets` | Tickets (default) | `mart_tickets` | `ticket_id`, `status`, `priority`, `queue_name`, `assignee_name`, `created_at` |
| `tk.notes` | Notes / comments / replies | `mart_ticket_notes` | `ticket_note_id`, `ticket_id`, `author_name`, `visibility`, `is_internal_note`, `created_at` |
| `tk.audit` | Audit / escalation history | `mart_audit_events` | `audit_event_id`, `ticket_id`, `action`, `queue_name`, `actor_name`, `created_at` |
| `tk.queue` | Queue depth / membership | `mart_agent_queues` | `queue_id`, `queue_name`, `queue_type`, `sla_status`, `open_tickets`, `assigned` |
| `metric.certified` | `metricRequest` fallback only | template-driven | certified metric column(s) — scalar, not row drill |

Row scope uses `assignee_id` on `mart_tickets` when the user is not org-wide admin (same rules as semantic `assignee_or_team` scope).

Server parses `instruction` for hints (`open`, `queue Billing`, …) and merges with structured `filters`.

**Warehouse note:** if a mart is missing in Postgres, the API returns **400** `missing_warehouse_table` with a rebuild hint — not an opaque 500. Ops: run dbt marts, then `scripts/compile_sql_catalog.py`.

### 4.4 Request

```http
POST /v1/sql/query
Content-Type: application/json
```

```json
{
  "organizationId": 1000,
  "userId": 42,
  "originProduct": "ticketing",
  "originAgent": "ticket_lifecycle_executor",
  "instruction": "List open tickets in queue Billing assigned to the current user",
  "entityHint": "wt:Ticket",
  "limit": 50
}
```

| Field | Required | Notes |
|---|---|---|
| `organizationId`, `userId` | yes | Same as semantic |
| `originProduct` | yes | **`"ticketing"`** |
| `originAgent` | yes | **This worker’s runtime id** |
| `instruction` | yes | Agent-authored **row** task. No SQL, no table names |
| `entityHint` | recommended | **`"wt:Ticket"`** |
| `filters` | no | Structured hints (`dimension` / `column`, `op`, `values`) |
| `limit` | no | 1–500 |
| `metricRequest` | no | **Reporting fallback only** — see §4.5 |

### 4.5 `metricRequest` (semantic 503 fallback — reporting only)

When `/v1/semantic/query` returns **503**, analytics workers may POST `/v1/sql/query` with the **same** structured body nested as `metricRequest`:

```json
{
  "organizationId": 1000,
  "userId": 42,
  "originProduct": "ticketing",
  "originAgent": "analytics_audit_query_executor",
  "instruction": "fallback",
  "entityHint": "wt:Ticket",
  "metricRequest": {
    "organizationId": 1000,
    "userId": 42,
    "product": "ticketing",
    "agent": "analytics_audit_query_executor",
    "metrics": ["open_tickets_metric"]
  }
}
```

Uses pre-approved template SQL from **`sql_agent/kpi_templates/ticketing.yml`** (same certified formulas as semantic / dbt — **95 templates**). Response `_meta.source` is `metric_fallback`. **Lifecycle agents must not** set `metricRequest`. List Skills must **not** use `metricRequest` for convenience.

### 4.6 SQL response (client shape)

Same row shaping as semantic — `rows` plus optional `status` / `threshold` when metrics were involved. Server diagnostics live in `_meta` (safe to log; do not depend on them for business logic):

```json
{
  "rows": [
    {
      "ticket_id": "…",
      "status": "open",
      "priority": "P2",
      "queue_name": "Billing",
      "assignee_name": "…",
      "created_at": "…"
    }
  ],
  "status": "not_applicable",
  "threshold": null,
  "_meta": {
    "source": "sql_list",
    "presetId": "tk.tickets",
    "planner": "gemma",
    "planId": "…",
    "latencyMs": 120,
    "table": "mart_tickets",
    "scope": { "mode": "assignee_or_team", "visibleUserIds": [42] },
    "warnings": ["coerced_table:mart_audit_events→mart_tickets"]
  }
}
```

| `_meta` field | Meaning |
|---|---|
| `source` | `sql_list` \| `metric_fallback` \| `sql_count` |
| `presetId` | SQL preset Gemma chose (§4.3) |
| `planner` | `gemma` (or fallback planner label) |
| `table` | Mart table queried |
| `scope` | Row scope applied server-side |
| `warnings` | Optional coercion / alignment notices |

Raw SQL is **not** returned to Ticketing clients (server logs only).

### 4.7 Error responses (integrators)

All SQL agent client errors use `{ "detail": { "code": "…", "message": "…" } }`. HTTP 503 may include `"retry": true`.

| HTTP | `detail.code` | Ticketing action |
|---|---|---|
| 400 | `kpi_not_allowed` | Remount `analytics_audit_query_executor` / `insights_analytics_executor` for KPI phrasing |
| 400 | `unknown_table` | Fix instruction / entityHint; do not send table names |
| 400 | `unknown_preset` | Internal planner issue — retry with clearer list intent |
| 400 | `invalid_plan` | Plan validation failed (e.g. SQL in model output) |
| 400 | `plan_failed` | Gemma could not plan — simplify instruction |
| 400 | `write_denied` | Route mutations to Express |
| 400 | `cross_product_denied` | Wrong product preset — ensure `originProduct: "ticketing"` |
| 400 | `missing_warehouse_table` | Ops: build dbt marts + recompile catalog |
| 400 | `missing_warehouse_column` | Catalog/warehouse drift — recompile catalog |
| 400 | `validation_error` | Read-only SQL validation failed |
| 400 | `unknown_metric` | Bad `metricRequest.metrics` id on fallback |
| 503 | `unavailable` | Gemma or Postgres down — retry; optional semantic→SQL fallback chain |
| 500 | `internal` | Unexpected fault — check server logs |

Do **not** parse free-text `detail` strings; use **`detail.code`** for branching and user messaging.

---

## 5. Router logic to implement in Ticketing

```
if utterance is how-many / rate / average / CSAT / SLA% / volume / dashboard number:
    remount analytics_audit_query_executor (staff chat / catalog analytics)
      OR insights_analytics_executor (insights Skill / TIAA-bound scheduled runs)
    that worker: POST /v1/semantic/query
      agent = that worker's runtime id  (never tiaa — not registered)
      metrics = ids chosen from its slice.metrics (or full catalog if coded)

else if utterance is list / show / search / open / get ticket rows or notes:
    remount ticket_lifecycle_executor
    that worker: POST /v1/sql/query
      originAgent = "ticket_lifecycle_executor"
      entityHint = "wt:Ticket"

else:
    existing Express / MCP Skill (create, update, note, assign, escalate, resolve, KB, macros, …)
    Context Layer is not used for the write
```

**Do not** call semantic and SQL in the same turn for the same question.

**Do not** send KPI questions to lifecycle SQL — Context Layer will 400 on list-only agents.

---

## 6. Payload `agent` / `originAgent` map (send these exact strings)

**Rule:** HTTP `agent` = column **Runtime id**. Same string on slice, semantic, and SQL.

### 6.1 Super

| Runtime id (`agent`) | Slice preset | Ontology | Semantic | SQL | Ticketing tools |
|---|---|---|---|---|---|
| `ticketing_super_agent` | `tk.super` | Yes — route only | **No** | **No** | Route to Domain. KPI → remount analytics. List → remount lifecycle |

Compact alias: `tk.super`. Prefer the runtime id you already log.

### 6.2 Domains (planning only)

| Runtime id | Slice preset | Semantic | SQL |
|---|---|---|---|
| `intake_deflection_domain` | `tk.intake_deflection_domain` | No | No |
| `triage_routing_domain` | `tk.triage_routing_domain` | No | No |
| `resolution_lifecycle_domain` | `tk.resolution_lifecycle_domain` | No | No |
| `knowledge_domain` | `tk.knowledge_domain` | No | No |
| `catalog_administration_domain` | `tk.catalog_administration_domain` | No | No |

Domains only `delegate_to_executor`. They do not collect slots, query KPIs, or list rows.

### 6.3 Executors — analytics (semantic YES)

| Runtime id | Slice preset | Semantic `agent=` | SQL |
|---|---|---|---|
| `analytics_audit_query_executor` | `tk.analytics_audit_query_executor` | **same id** | `metricRequest` fallback only after semantic 503 |
| `insights_analytics_executor` | `tk.insights_analytics_executor` | **same id** | same |

Compact alias: `tk.reporting` → same preset as `tk.analytics_audit_query_executor`. **Do not** send `tk.reporting` from a non-reporting worker.

**Proactive twins are not registered.** Do not send `tiaa` — use `insights_analytics_executor`.

### 6.4 Executors — tickets (SQL lists YES, semantic NO)

| Runtime id | Slice preset | Semantic | SQL `originAgent=` |
|---|---|---|---|
| `ticket_lifecycle_executor` | `tk.ticket_lifecycle_executor` | No | **same id** |
| `ticket_creation_executor` | `tk.ticket_creation_executor` | No | same id (search/duplicate lists only) |

### 6.5 Executors — catalog (ontology YES, no semantic, no SQL)

| Runtime id | Slice preset |
|---|---|
| `team_queue_crud_executor` | `tk.team_queue_crud_executor` |
| `kb_quality_crud_executor` | `tk.kb_quality_crud_executor` |
| `macro_crud_executor` | `tk.macro_crud_executor` |
| `customer_directory_crud_executor` | `tk.customer_directory_crud_executor` |
| `priority_status_crud_executor` | `tk.priority_status_crud_executor` |
| `org_settings_integrations_executor` | `tk.org_settings_integrations_executor` |
| `notification_inbox_executor` | `tk.notification_inbox_executor` |
| `automation_rule_crud_executor` | `tk.automation_rule_crud_executor` |

Writes/lists stay on existing MCP/Express.

### 6.6 Executors — assist / resolution (per-agent ontology, no semantic)

Each executor has its own `tk.*` preset. Send **the harness runtime id** (not proactive codes).

| Runtime id | Slice preset | Semantic | SQL |
|---|---|---|---|
| `ai_resolution_executor` | `tk.ai_resolution_executor` | No | No |
| `classification_priority_executor` | `tk.classification_priority_executor` | No | No |
| `intelligent_assignment_executor` | `tk.intelligent_assignment_executor` | No | No |
| `workload_optimization_executor` | `tk.workload_optimization_executor` | No | No |
| `root_cause_learning_executor` | `tk.root_cause_learning_executor` | No (graph only) | No |
| `investigation_summary_executor` | `tk.investigation_summary_executor` | No | No |
| `sla_escalation_executor` | `tk.sla_escalation_executor` | No | No |
| `customer_reply_drafting_executor` | `tk.customer_reply_drafting_executor` | No | No |
| `autonomous_resolution_executor` | `tk.autonomous_resolution_executor` | No | No |
| `resolution_quality_executor` | `tk.resolution_quality_executor` | No | No |
| `personalized_notification_executor` | `tk.personalized_notification_executor` | No | No |
| `resolution_knowledge_executor` | `tk.resolution_knowledge_executor` | No | No |
| `similar_ticket_detection_executor` | `tk.similar_ticket_detection_executor` | No | Optional similar **rows** only |

**Proactive codes are not registered** (`tcaa`, `dssa`, `icpa`, `itra`, `wloa`, `rcaa`, `tsaa`, `sema`, `crda`, `ara`, `rqa`, `pna`, `rkaa`, `stda`, `tiaa`). Slice/semantic/SQL with those ids → HTTP 400. Proactive workers execute tools through their bound harness executor + Skill.

### 6.7 Portal

| Runtime id | Slice | Semantic | SQL |
|---|---|---|---|
| `tk.portal` | `tk.portal` | No | No org analytics. Own tickets via portal APIs |

### 6.8 ASGA

| Id | Slice | Semantic | SQL |
|---|---|---|---|
| `asga` | **Do not call** | No | No |

---

## 7. Discovery, health, and reload (ops)

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness; includes MetricFlow warm status for `ccaas` + `ticketing` |
| `GET /v1/version` | Service + ontology version |
| `GET /v1/agents` | List registered runtime ids |
| `GET /v1/presets` | List preset ids (`tk.super`, `tk.ticket_lifecycle_executor`, `tk.analytics_audit_query_executor`, …) |
| `GET /v1/modules` | List ontology modules |
| `GET /v1/metrics/{id}?organizationId=` | Metric schema + thresholds (debug) |
| `POST /v1/admin/reload` | Clear caches + re-warm after YAML/dbt changes (`X-Reload-Secret`) |

After catalog or `agents.yml` edits, reload before expecting Ticketing to see new runtime ids or metrics.

**Runtime notes (server):** shared Postgres pool, 60s context/allowlist cache, MetricFlow SQL cache, template registry cache — all cleared on admin reload. SQL agent uses **`sql_agent/`** compiled catalogs and Gemma planner; validate presets with `python3 scripts/validate_sql_presets.py`.

---

## 8. Copy-paste examples

Replace host, org, and user.

### 8.1 Inject ontology (lifecycle)

```bash
curl -s http://127.0.0.1:8765/v1/ontology/slice \
  -H 'Content-Type: application/json' \
  -d '{
    "organizationId": 1000,
    "userId": 42,
    "product": "ticketing",
    "agent": "ticket_lifecycle_executor"
  }'
```

Use `response.prompt`. Expect `metrics` empty or absent for allowlist.

### 8.2 Inject ontology (analytics)

```bash
curl -s http://127.0.0.1:8765/v1/ontology/slice \
  -H 'Content-Type: application/json' \
  -d '{
    "organizationId": 1000,
    "userId": 42,
    "product": "ticketing",
    "agent": "analytics_audit_query_executor"
  }'
```

Use `response.prompt` and `response.metrics[].id` as KPI vocabulary.

### 8.2b Inject ontology (insights executor)

```bash
curl -s http://127.0.0.1:8765/v1/ontology/slice \
  -H 'Content-Type: application/json' \
  -d '{
    "organizationId": 1000,
    "userId": 42,
    "product": "ticketing",
    "agent": "insights_analytics_executor"
  }'
```

Same headline metrics as analytics-audit; distinct rules in `prompt` for insights Skill. Proactive `tiaa` must **not** be used here — bind to this runtime id.

### 8.3 KPI (semantic — primary)

```bash
curl -s http://127.0.0.1:8765/v1/semantic/query \
  -H 'Content-Type: application/json' \
  -d '{
    "organizationId": 1000,
    "userId": 42,
    "product": "ticketing",
    "agent": "analytics_audit_query_executor",
    "metrics": ["open_tickets_metric"]
  }'
```

### 8.4 Ticket list (SQL — rows)

```bash
curl -s http://127.0.0.1:8765/v1/sql/query \
  -H 'Content-Type: application/json' \
  -d '{
    "organizationId": 1000,
    "userId": 42,
    "originProduct": "ticketing",
    "originAgent": "ticket_lifecycle_executor",
    "instruction": "List open tickets in queue Billing",
    "entityHint": "wt:Ticket",
    "limit": 50
  }'
```

### 8.5 Ticket notes (SQL — routed table)

```bash
curl -s http://127.0.0.1:8765/v1/sql/query \
  -H 'Content-Type: application/json' \
  -d '{
    "organizationId": 1000,
    "userId": 42,
    "originProduct": "ticketing",
    "originAgent": "ticket_lifecycle_executor",
    "instruction": "Show internal notes for ticket T-1042",
    "entityHint": "wt:Ticket",
    "limit": 20
  }'
```

### 8.6 Expected failures (do not “fix” by changing agent to reporting)

| Call | Expected |
|---|---|
| Super + `open_tickets_metric` on semantic | 400 not entitled |
| Lifecycle + `open_tickets_metric` on semantic | 400 not entitled |
| Lifecycle + SQL instruction “how many open tickets” | 400 `{ "code": "kpi_not_allowed" }` — route to analytics |
| Lifecycle + SQL instruction “list open tickets” | 200, `_meta.source: sql_list`, multiple rows |
| Analytics + `product: "contact_centre"` | 400 product mismatch |
| `agent: "not_registered_executor"` | 400 unknown agent |
| `agent: "tiaa"` or `agent: "dssa"` on slice/semantic/SQL | 400 unknown agent — use harness executor id |
| Semantic with empty `metrics` | 400 |
| Org without ticketing SKU | 403 on slice/semantic |
| Semantic 503 then SQL `metricRequest` from analytics | 200 `_meta.source: metric_fallback` (optional) |
| SQL when mart missing in Postgres | 400 `{ "code": "missing_warehouse_table" }` |
| Gemma planner timeout | 503 `{ "code": "unavailable", "retry": true }` |

---

## 9. What Ticketing Cursor should change in code

1. **HTTP client** to Context Layer (base URL from env, JSON, timeouts). No dbt.
2. **Slice cache** keyed by `(organizationId, userId, runtimeAgentId)` — **one cache entry per harness worker** (31 distinct prompts); invalidate on admin reload signal or TTL.
3. **Prompt builder:** `existing agent.md` + `"\n\n" + slice.prompt`. Each executor gets its own compact ontology (types/actions/rules), not a shared `tk.proactive` / `tk.tickets` dump.
4. **Proactive workers:** on `propose()` use the **harness executor runtime id** for any Context Layer call (e.g. `insights_analytics_executor`, not `tiaa`).
5. **Analytics Skills:** map NL → `metrics[]` + optional `group_by` / `time`. `agent` = `analytics_audit_query_executor` or `insights_analytics_executor`. On 503, optional `metricRequest` on SQL.
6. **ticket-read-search Skill:** Express list **or** `/v1/sql/query` with `originAgent: ticket_lifecycle_executor` — not both for the same turn unless merging is explicit. Parse SQL **`detail.code`** on 400/503; log `_meta.warnings` when present.
7. **Super classifier:** how-many → analytics executor; list/show tickets → lifecycle; else Express.
8. **Do not** add Context Layer calls to ASGA or Domain workers beyond slice inject.
9. **Do not** point lifecycle workers at semantic for KPIs or at SQL for KPI phrasing.
10. If a live runtime string is missing from §6, register in `ontology/agents.yml` and reload — do not guess. Do **not** register proactive codes as slice agents.

---

## 10. Acceptance checklist

### Ontology (per-agent)

- [ ] All **31 harness** runtime ids return a slice; each maps to a `tk.*` preset (§2.5).
- [ ] Super prompt: data YAML with `entities:` / `SupportCase` / `identifier: ticketing.tickets.id`; full ticketing graph (all product nodes under `entities`); **empty** `metrics`.
- [ ] Domain prompts: graph entity subset only (no actions/routing in YAML); **empty** `metrics`.
- [ ] `ticket_lifecycle_executor` vs `ticket_creation_executor` prompts differ (lifecycle vs create types/actions).
- [ ] Retired ontology ids (`tk.tickets`, `tk.proactive`, `tk.teams`, …) are **not** in `GET /v1/agents`.
- [ ] Proactive ids (`tiaa`, `dssa`, …) → slice **400** unknown agent.
### Semantic

- [ ] `analytics_audit_query_executor` and `insights_analytics_executor` prompts contain **12 headline** metric ids (§3.6); API accepts all **96** certified ids.
- [ ] “How many open tickets?” → semantic 200, `agent=analytics_audit_query_executor`, metric `open_tickets_metric`.
- [ ] Same question from Super **without** remount → 400 (must remount).
- [ ] Same question with `agent=tiaa` → 400 unknown agent.
- [ ] `validate_ticketing_core_metrics.py` — 10/10 core KPIs match mart ground truth (org 1000).
- [ ] Scalar KPIs use `sql_template` fast path when no `group_by` / `time.grain` / filters.

### SQL

- [ ] Same KPI question on lifecycle SQL → 400 `{ "code": "kpi_not_allowed" }`.
- [ ] “Show my open tickets” → SQL 200, `originAgent=ticket_lifecycle_executor`, `_meta.source=sql_list`, **multiple rows**.
- [ ] “Show notes on ticket …” → SQL 200, `_meta.presetId=tk.notes`, rows from notes mart.
- [ ] SQL catalog/plan errors return `{ "detail": { "code", "message" } }` — not opaque 500.

### General

- [ ] `GET /health` succeeds; `ticketing` in MetricFlow warm set (or degraded documented).
- [ ] Create ticket still Express; no INSERT through Context Layer.
- [ ] Portal cannot query org CSAT / org open-ticket KPIs.
- [ ] `product` / `originProduct` is `ticketing` on all calls.
- [ ] `sla_breach_rate` with `product: ticketing` ≠ CCaaS formula.

---

## 11. Identity

| Field | Source in Ticketing | Sent as |
|---|---|---|
| Org | Session / JWT / org context | `organizationId` (integer) |
| Staff user | JWT / session (`ticketing.agents.id`) | `userId` (integer) — **agents.id**, not MyAccount id |
| Customer portal | Session customer | Org + portal user id; scope “own tickets” only |
| Open ticket on screen | UI context | SQL `instruction` or Express get-one — not as `agent` |

If `userId` is missing, do not call semantic/SQL.

---

## 12. Out of scope for v1

- Calling Hub (`POST /v1/ontology/hub`) from Ticketing staff chat (Super uses `spoke_query` to Hub; Hub loads its own slice)
- Registering proactive codes (`tiaa`, `dssa`, …) as slice/semantic/SQL agents — use harness executor ids
- Re-attaching retired shared ontology presets (`tk.tickets`, `tk.proactive`, `tk.teams`, …) to runtime ids
- New Context Layer agent ids without `agents.yml` registration
- Injecting the full metric catalog into non-reporting workers
- Replacing Express mutations
- Sending NL to semantic query
- Free-form SQL or table names from Ticketing agents
- Calling `semantic/sql/` executors directly — use **`POST /v1/sql/query`** only (server routes to `sql_agent/`)

---

## Related docs (this repo)

- [TICKETING_AGENTS_ONTOLOGY.md](TICKETING_AGENTS_ONTOLOGY.md) — **per-agent ontology map** (runtime id → preset → types/actions; proactive bindings)
- [ticketing-agents-hierarchy-and-ontology.md](ticketing-agents-hierarchy-and-ontology.md) — MAS hierarchy, Skills, proactive 1:1 bindings
- [ticketing_agents.md](ticketing_agents.md) — full MAS inventory (legacy)
- [ticketing-agent-ontology-handoff.md](ticketing-agent-ontology-handoff.md) — detailed handoff brief
- [TICKETING_ONTOLOGY_FULL_PROMPT.txt](TICKETING_ONTOLOGY_FULL_PROMPT.txt) — static full ontology block (reference)
- [TICKETING_ONTOLOGY_FULL_PROMPT.raw.txt](TICKETING_ONTOLOGY_FULL_PROMPT.raw.txt) — readable full ontology
- [SQL_AGENT.md](SQL_AGENT.md) — SQL Super design (shared with CCaaS; execution in `sql_agent/` — see §4.0)
- [ONTOLOGY_AND_SEMANTIC_LAYER.md](ONTOLOGY_AND_SEMANTIC_LAYER.md) — ontology + semantic overview
- [api/README.md](../api/README.md) — HTTP reference

**Validate after ontology changes:**

```bash
PYTHONPATH=. python3 scripts/validate_ontology_architecture.py
PYTHONPATH=. python3 scripts/test_metric_ownership.py
```
