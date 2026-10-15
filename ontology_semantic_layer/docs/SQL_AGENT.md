# SQL Agent — Design & Implementation

**Last updated:** 2026-09-20  
**Endpoint:** `POST /v1/sql/query`  
**Package:** `sql_agent/` (isolated from MetricFlow / `semantic.query`)

Two-level read-only SQL path for **row-level data** (lists, search, notes, audit, queues) plus **instruction-first** scalar counts and certified KPI templates.  
**Certified KPIs also stay on MetricFlow** — `POST /v1/semantic/query`.  
SQL agent may run **pre-approved KPI templates** when intent is `kpi` and the metric passes harness filter validation (same formulas as dbt — not ad-hoc LLM math).

---

## Instruction-first (IntentKind)

Single intent enum everywhere: `list | count_scalar | count_grouped | kpi`.

| Intent | Behavior |
|--------|----------|
| `list` | Row retrieval; harness **strips** `metric_id`/`template_id` |
| `count_scalar` | `SELECT COUNT(*)::bigint AS row_count` with explicit filters + scope |
| `count_grouped` | `GROUP BY` breakdown counts |
| `kpi` | Certified template via `metric_fallback` only if `metric_validator` passes |

**Harness branch order:** `group_by` → `list` (strip metric) → `count_scalar` → `kpi` (validate) → else scalar-shaped instruction → `count_scalar` else `list`.

**Feature flag `INSTRUCTION_FIRST`:**
- unset / `0` — **shadow**: legacy response (including `metricRequest` force-KPI); logs `instruction_first_diff`
- `1` / `true` — new behavior; `metricRequest` is a soft hint only (deprecated as a force path)

**Errors:** `code=needs_clarification` with `reason`, `missing`, `candidates` (unknown dimension, ambiguous assignee).

**List quality:** default limit **20**, max **200**; `ORDER BY` required whenever `LIMIT` is present (tickets default `created_at DESC`; priority-rank when priority is mentioned).

---

## Architecture

```text
Hub / Spoke agent
       │
       ▼  instruction + entityHint (no SQL, no table names)
POST /v1/sql/query  [api/main.py]
       │
       ▼
execute_sql_query()                    sql_agent/super.py
       │  INSTRUCTION_FIRST on|shadow
       ├── intent_gate()                sql_agent/mas/intent_gate.py
       ├── plan_sql_query()             sql_agent/mas/super_planner.py
       │     Gemma JSON plan (IntentKind) OR regex fallback (no SQL)
       │
       └── execute_plan()               sql_agent/mas/orchestrator.py
             validate_constrained_job()  sql_agent/mas/harness.py
             constrained_to_executor_job()  (+ metric_validator, scope clamp)
             _dispatch() → product executor
                   │
                   ├── sql_agent/executors/ticketing.py   → Postgres
                   ├── sql_agent/executors/ccaas.py       → Postgres
                   ├── sql_agent/executors/crm.py         → Postgres
                   ├── sql_agent/executors/campaign.py    → Postgres
                   └── sql_agent/executors/webtracking.py → ClickHouse
```

| Level | Module | Role |
|-------|--------|------|
| **API** | `api/main.py` | Auth-shaped request; maps typed errors to HTTP 400/503; shapes client `rows` + `_meta` |
| **Super entry** | `sql_agent/super.py` | Write-deny gate; orchestrates plan → execute |
| **Gemma planner** | `sql_agent/mas/super_planner.py` | NL → `SqlPlan` (`intent`, `preset_id`, `product`, optional `table`/`select`/`filters`) |
| **Harness** | `sql_agent/mas/harness.py` | Fail-closed catalog validation; org scope; compile `ExecutorJob` |
| **Executor** | `sql_agent/executors/*.py` | Build parameterized SELECT; call `sql_agent/db.py` |
| **Warehouse** | `sql_agent/db.py` | Postgres (shared pool) or ClickHouse; wrap missing-table errors |

Hub and spoke agents **never** call executors directly.  
`semantic/sql/` is a **compatibility shim** that re-exports `sql_agent` — new code should import `sql_agent` only.

---

## What goes where

| User need | Route | Example |
|-----------|--------|---------|
| KPI, rate, average, trend, breakdown | **MetricFlow** (`/v1/semantic/query`) | AHT by channel, open tickets metric, CSAT |
| Custom date range on certified metric | **MetricFlow** | WhatsApp AHT Aug 18–Sep 12 |
| Quarter / period compare | **MetricFlow** (2+ calls or `grain: month`) | Q3 vs Q2 ticket volume |
| List / search / detail rows | **SQL agent** | Open tickets in queue, conversation notes |
| Drill-down after a metric | **SQL agent** | “Show those WhatsApp conversations” |
| Cross-model KPI in one shot | **Not one query** — 2 semantic calls or merge row sets | open convos + ticket SLA rate |
| MetricFlow down / semantic 503 | **SQL `metricRequest` fallback** | Pre-approved template from `sql_agent/kpi_templates/` |

**Rule:** Free-form list executors **retrieve rows**. MetricFlow **calculates certified numbers**.  
SQL agent **never** re-implements certified formulas in ad-hoc SELECT math.

---

## Request contract

### Hub / Spoke → `POST /v1/sql/query`

| Field | Required | Purpose |
|-------|----------|---------|
| `organizationId`, `userId` | yes | Tenant + row scope |
| `originProduct` | yes | Policy routing (`ticketing`, `contact_centre`, `crm`, …) |
| `originAgent` | yes | Runtime agent id — allowlist / list-only policy |
| `instruction` | yes | Agent-authored natural language (row tasks) |
| `entityHint` | recommended | e.g. `wt:Ticket`, `wt:Conversation` — routes product/table default |
| `filters` | no | Structured hints (`dimension`/`column`, `op`, `values`) |
| `limit` | no | 1–200 (default 20) |
| `metricRequest` | no | Soft/deprecated — hint only when `INSTRUCTION_FIRST=1`; forced KPI when flag off (shadow) |

Do **not** send: raw SQL, table names, schema names, executor ids.

### Server-injected (never from client)

- Entitlements / SKUs (`semantic/entitlements.py`)
- User scope: role, team, `visibleUserIds` (`sql_agent/user_scope.py`)
- `organization_id` WHERE clause on every query
- Row scope (`assignee_id` / visible users) when catalog defines `row_scope_column`
- Channel IN filter when table supports `channel` column (`mart_tickets`, `mart_conversations`)
- Read-only validation (`sql_agent/validator.py`) before every warehouse execute

---

## Execution pipeline

### 1. Plan (`plan_sql_query`)

1. If `metricRequest` is set → plan `preset_id: metric.certified`, `intent: kpi` (skip Gemma).
2. Else call **Gemma** (`sql_agent/mas/gemma_client.py`) with `preset_catalog` for the origin product.
3. Gemma returns JSON only — **no `sql` field**. Allowed keys: `intent`, `preset_id`, `product`, `metric_id`, `template_id`, `table`, `select`, `filters`, `limit`.
4. **`_align_preset_id`** — if Gemma picks a preset for the wrong product (e.g. `tk.tickets` on `contact_centre`), realign to origin default unless cross-product is entitled.
5. **`_plan_catalog_product`** — warehouse catalog product comes from the **preset**, not a mismatched plan field.
6. On `GemmaParseError` / invalid JSON → **regex fallback** (`planner: regex_fallback`) using instruction keywords.
7. On Gemma timeout/unavailable → HTTP **503** (`unavailable`, `retry: true`).

Default preset per product when alignment/fallback runs:

| Product | Default preset |
|---------|----------------|
| ticketing | `tk.tickets` |
| ccaas | `cc.conversations` |
| crm | `crm.deals` |
| campaign | `camp.overview` |
| webtracking | `wt.sessions` |

### 2. Orchestrate (`execute_plan`)

| Check | Error code |
|-------|------------|
| Write verbs in instruction | `write_denied` |
| List-only agent + KPI intent or count phrasing | `kpi_not_allowed` |
| `intent: count` (non-certified) | Plain `sql_count` path (reporting agents only) |

### 3. Harness (`validate_constrained_job`)

- Reject SQL in model output → `invalid_plan`
- Validate preset exists → `unknown_preset`
- **`_coerce_preset_table`** — if table not in preset allowlist, use preset `default_table` and emit `coerced_table:old→new` warning
- Validate columns against compiled catalog; drop unknown columns with warning
- Validate joins against compiled catalog → `invalid_join`
- Validate certified templates → `unknown_template`
- Org SKU entitled → `not_entitled`

Set `SQL_AGENT_STRICT=1` to turn dropped columns/filters into `strict_validation` errors.

### 4. Execute (`ExecutorJob`)

| `mode` | Path | Response `_meta.source` |
|--------|------|-------------------------|
| `list` | `build_list_sql` → Postgres/CH | `sql_list` |
| `group_count` | `build_ticketing_group_sql` (ticketing) | `sql_group` |
| `metric_fallback` | `sql_agent/metric_fallback.py` → template SQL | `metric_fallback` |
| `count` | `build_count_sql` (orchestrator shortcut) | `sql_count` |

Product dispatch: `sql_agent/super.py` → `sql_agent/executors/{product}.py` → `generic.execute_job`.

---

## Response contract

Client body (via `shape_client_response` in API):

```json
{
  "rows": [ { "ticket_id": "…", "status": "open" } ],
  "status": "not_applicable",
  "threshold": null,
  "_meta": {
    "source": "sql_list",
    "presetId": "tk.tickets",
    "planner": "gemma",
    "planId": "…",
    "latencyMs": 120,
    "table": "mart_tickets",
    "scope": { "mode": "assignee_or_team", "visibleUserIds": ["42"] },
    "warnings": ["coerced_table:mart_audit_events→mart_tickets"]
  }
}
```

| `_meta` field | Meaning |
|---------------|---------|
| `source` | `sql_list` \| `sql_group` \| `metric_fallback` \| `sql_count` |
| `presetId` | SQL preset from `sql_agent/presets/catalog.yml` |
| `planner` | `gemma` \| `regex_fallback` |
| `table` | Mart queried |
| `scope` | Row scope applied server-side |
| `warnings` | Coercion / dropped column / filter notices |

Raw SQL is logged server-side; **not** returned to spoke clients.

---

## Preset catalog

Presets live in **`sql_agent/presets/catalog.yml`**. Gemma must pick from this list (filtered by product in the planner prompt).

### Ticketing (standalone operational + CDP)

Ticketing SQL Super reads **`ticketing.*` operational tables**, not `ticketing_marts`. Marts remain for MetricFlow/semantic only.

| Preset | Default table | Purpose |
|--------|---------------|---------|
| `tk.tickets` | `tickets` | Ticket lists, filters, group-by counts |
| `tk.queue` | `agent_queues` | Queue depth / SLA status |
| `tk.notes` | `ticket_notes` | Notes / comments |
| `tk.audit` | `audit_events` | Audit / escalation history |
| `tk.contacts` | `contact_profile` | Support contact profiles |
| `tk.accounts` | `ticketing_accounts` | B2B client accounts |
| `tk.statuses` | `ticket_statuses` | Status enum catalog |
| `tk.kb` | `kb_articles` | Knowledge base |
| `tk.macros` | `macros` | Canned responses |

**Identity:** `userId` = `ticketing.agents.id` (not `accounts.setup_users.id`).  
**Scope:** admin/viewer → org; agent → assignee; resolver → assignee OR resolver; explicit team → `my_queue_ids`. Named other staff → `scope_denied` for agent/resolver.  
**Planner:** Gemma JSON only for ticketing — no regex instruction parser, no regex planner fallback (`plan_failed`).  
**KPI paths:** scalar certified templates on `ticketing.tickets`; breakdowns (`count by queue_name`) use executor `GROUP BY` (`source: sql_group`), not scalar templates.  
**CDP:** live customer email/name via `contact_profile` → `cdp.identity_keys` when plan sets `cdp_live` / `cdp_email`; snapshot columns on `tickets` otherwise.

### CCaaS

| Preset | Default table |
|--------|---------------|
| `cc.conversations` | `mart_conversations` |
| `cc.queue` | `mart_setup_ccaas_queues` |
| `cc.sla` | `mart_conversation_sla_state` |
| `cc.assignments` | `mart_conversation_assignments` |
| `cc.tasks` | `mart_agent_tasks` |
| `cc.presence` | `mart_agent_presence_history` |
| `cc.agent_assist` | `mart_copilot_turns` |
| `cc.agents` | `mart_agents` |

### CRM

| Preset | Default table |
|--------|---------------|
| `crm.deals` | `mart_deals` |
| `crm.contacts` | `mart_contacts` |
| `crm.companies` | `mart_companies` |
| `crm.orders` | `mart_orders` |
| `crm.engagement` | `mart_contact_activities` |

### Campaign

| Preset | Default table |
|--------|---------------|
| `camp.overview` | `mart_campaign_overview` |
| `camp.touch` | `mart_campaign_touch_performance` |
| `camp.delivery` | `mart_campaign_batch_health` |

### Webtracking

| Preset | Default table | Engine |
|--------|---------------|--------|
| `wt.sessions` | `mart_web_sessions` | ClickHouse |
| `wt.visitors` | `mart_web_visitors` | ClickHouse |
| `wt.conversions` | `mart_conversion_events` | ClickHouse |
| `wt.pageviews` | `mart_page_views` | ClickHouse |

### Certified fallback

| Preset | Purpose |
|--------|---------|
| `metric.certified` | `metricRequest` / KPI template execution only |

---

## Products, engines & schemas

| Product | `originProduct` aliases | Engine | Default schema | Executor module |
|---------|-------------------------|--------|----------------|-----------------|
| ccaas | `contact_centre`, `contact-center`, `ccaas`, `aiccaas` | Postgres | `ccass_marts_aiccaas` | `sql_agent.executors.ccaas` |
| ticketing | `ticketing` | Postgres | `ticketing` (operational; CDP joins when needed) | `sql_agent.executors.ticketing` |
| crm | `crm` | Postgres | `crm_marts` | `sql_agent.executors.crm` |
| campaign | `campaign` | Postgres | `campaign_marts` | `sql_agent.executors.campaign` |
| webtracking | `webtracking`, `web-tracking` | ClickHouse | `webtracking_marts` | `sql_agent.executors.webtracking` |

Entity hints (`sql_agent/router.py`):

| `entityHint` | Routes to product | Default table |
|--------------|-------------------|---------------|
| `wt:Ticket` | ticketing | `tickets` |
| `wt:Conversation`, `wt:Interaction` | ccaas | `mart_conversations` |
| `wt:Deal`, `wt:Contact`, `wt:Customer` | crm | `mart_deals` / `mart_contacts` |
| `wt:Campaign` | campaign | `mart_campaign_overview` |
| `wt:Session`, `wt:Visitor`, `wt:PageView` | webtracking | `mart_web_sessions` |

Ticketing list/KPI SQL uses operational **`ticketing.*`** (see `sql_agent/catalog/sources/ticketing_operational.yaml`). Other products query dbt marts when possible.

---

## Catalog system

| Layer | Path | Role |
|-------|------|------|
| **Compiled (preferred)** | `sql_agent/catalog/compiled/{product}.yml` | Live warehouse columns, grains, `row_scope_column`, joins — generated by `scripts/compile_sql_catalog.py` |
| **Sources (fallback)** | `sql_agent/catalog/sources/{product}.yaml` | Hand-maintained allowlist when compiled file missing |
| **Ticketing operational** | `sql_agent/catalog/sources/ticketing_operational.yaml` | Preferred catalog for ticketing SQL list/KPI/group paths |
| **Joins** | `sql_agent/catalog/sources/joins.yml` | In-product join allowlist |
| **Loader** | `sql_agent/catalog_loader.py` | `get_table()` → `SqlAgentError(unknown_table)` if missing |

Regenerate compiled catalogs after dbt mart deploy:

```bash
python3 scripts/compile_sql_catalog.py
python3 scripts/validate_sql_presets.py
```

---

## KPI templates (`metric_fallback`)

When `metricRequest` is set on `/v1/sql/query`, the planner skips Gemma and runs certified SQL templates:

| Product | Template dir | Count |
|---------|--------------|------:|
| ticketing | `sql_agent/kpi_templates/ticketing.yml` | 95 |
| ccaas | `sql_agent/kpi_templates/ccaas.yml` | (product set) |
| crm | `sql_agent/kpi_templates/crm.yml` | |
| campaign | `sql_agent/kpi_templates/campaign.yml` | |
| webtracking | `sql_agent/kpi_templates/webtracking.yml` | |

Registry: `sql_agent/kpi_template_registry.py` · execution: `sql_agent/metric_fallback.py`.

Ticketing scalar templates target **`ticketing.tickets`** with catalog status values (`Open`, `Resolved`, …). When the plan includes **`group_by`**, the harness routes to **`group_count`** executor SQL instead of a scalar template.

**Intended use:** reporting agent fallback after `/v1/semantic/query` returns **503**.  
List-only CCaaS agents (`cc.ai_support`, `cc.coworker`) must **not** set `metricRequest`. Ticketing origin agents may run lists, scalar KPIs, and group counts.

---

## Agent policy (`sql_agent/agent_policy.py`)

### List-only agents

These agents may only run **`intent: list`** row retrieval. KPI phrasing, count intent, or `metricRequest` → `kpi_not_allowed`:

| Product | Runtime `originAgent` |
|---------|----------------------|
| CCaaS | `cc.ai_support`, `cc.coworker` |

Reporting agents (e.g. `cc.reporting`, `tk.reporting`, `analytics_audit_query_executor`) may use `metric_fallback`, group counts, and count paths when entitled.

### KPI redirect heuristics

Instruction patterns (`open tickets`, `CSAT`, `AHT`, …) map to certified metric ids for **suggest_metric_request** and list-only blocking — spokes should still route KPI questions to `/v1/semantic/query` first.

---

## Cross-product access (`sql_agent/mas/cross_product.py`)

| Origin | May also query (if entitled) |
|--------|------------------------------|
| hub | ticketing, ccaas, crm, campaign, webtracking, cdp |
| ccaas | ticketing |
| crm | campaign |
| ticketing | — |
| campaign | — |
| webtracking | — |

Violation → HTTP 400 `cross_product_denied`.  
Planner aligns wrong-product presets to origin default when cross-product is not allowed (e.g. CCaaS model output on ticketing origin).

---

## Scope (aligned with semantic layer)

| Scope | Meaning | SQL application |
|-------|---------|-----------------|
| **org** | Whole tenant (entitled channels) | No assignee filter; channel IN when applicable |
| **assignee** | Caller’s tickets | WHERE on `row_scope_column` IN `visibleUserIds` (resolver: assignee OR resolver) |
| **team** | Caller’s queues + own tickets | `queue_id IN my_queue_ids` OR assignee/resolver match |

Resolved in `sql_agent/scope_resolver.py` + `sql_agent/user_scope.py` + `semantic/ticketing_scope.py`.  
Named-person filters on staff columns: admin/viewer allowed; agent/resolver → `scope_denied` unless self/team.

---

## Error model

Typed errors in `sql_agent/errors.py`:

| Class | HTTP | Use |
|-------|------|-----|
| `SqlAgentError` | 400 | Catalog, plan, policy, warehouse shape |
| `SqlValidationError` | 400 | Read-only SQL validation (`validation_error`) |
| `CrossProductError` | 400 | Cross-product denial (`cross_product_denied`) |
| `WarehouseUnavailableError` | 503 | Postgres/CH down (`unavailable`, `retry: true`) |
| `GemmaTimeoutError` / `GemmaUnavailableError` | 503 | Planner LLM unavailable |

Common `detail.code` values:

| Code | Meaning |
|------|---------|
| `kpi_not_allowed` | List-only agent + KPI/count |
| `unknown_table` | Table not in catalog or preset allowlist |
| `unknown_preset` | Invalid preset id |
| `unknown_metric` / `unknown_template` | Bad metric id on fallback |
| `invalid_plan` | Plan validation failed |
| `plan_failed` | Gemma could not plan (ticketing: no regex fallback) |
| `scope_denied` | Ticketing named-person or org-wide scope blocked for role |
| `write_denied` | DML/DDL verbs in instruction |
| `cross_product_denied` | Product not allowed from origin |
| `missing_warehouse_table` | Mart missing in Postgres/CH |
| `missing_warehouse_column` | Column drift vs catalog |
| `not_entitled` | Org lacks product SKU |
| `strict_validation` | `SQL_AGENT_STRICT=1` and dropped filters/columns |
| `internal` | Unexpected server fault (500) |

Body shape: `{ "detail": { "code": "…", "message": "…" } }` (+ `"retry": true` on 503).

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SQL_AGENT_LLM_URL` | `http://173.234.75.166:8011/v1` | Gemma OpenAI-compatible endpoint |
| `SQL_AGENT_LLM_TIMEOUT` | `2.0` | Planner timeout (seconds) |
| `SQL_AGENT_LLM_MODEL` | `worktual-gemma` | Model name |
| `SQL_AGENT_STRICT` | off | Fail on dropped filters/columns |
| `ch_host`, `ch_port`, `ch_user`, `ch_pass`, `ch_db` | — | ClickHouse (webtracking) |

Postgres uses shared `semantic/pg_pool.py` connection pool.

---

## Trust & safety

1. **Catalog allowlist** — unknown table/column → fail closed (`unknown_table` / column drop + warning)
2. **No DDL/DML** — instruction write-deny + `validate_readonly_sql` on every execute
3. **No ad-hoc certified math** — KPIs via templates or semantic MetricFlow only
4. **No SQL from LLM** — Gemma emits JSON plan only; SQL built server-side
5. **Preset table coercion** — wrong table realigned with logged warning
6. **One product per executor call** — cross-product requires entitlement matrix
7. **Row limit cap** — 500 max per request
8. **Typed client errors** — catalog/plan/policy failures return 400, not opaque 500

---

## Validation & tests

| Script | Purpose |
|--------|---------|
| `scripts/validate_sql_presets.py` | Preset tables/columns vs compiled catalogs |
| `scripts/compile_sql_catalog.py` | Regenerate `sql_agent/catalog/compiled/*.yml` from Postgres |
| `scripts/test_sql_agent_errors.py` | Typed errors, CCaaS preset alignment, warehouse wrap |
| `scripts/test_ticketing_sql_standalone.py` | Ticketing operational SQL, group_by, scope, plan_failed |
| `scripts/test_ticketing_agent_scope.py` | Ticketing agents.id scope unit tests |
| `scripts/test_sql_agent_products.py` | Per-product smoke |
| `scripts/validate_sql_agent_live.py` | Live API on `:8765` |
| `scripts/test_sql_mas_live.py` | End-to-end MAS spoke scenarios |

---

## Endpoints summary

| Endpoint | Caller | Purpose |
|----------|--------|---------|
| `POST /v1/sql/query` | Hub / spoke | SQL Super — list rows + optional `metric_fallback` |
| `POST /v1/semantic/query` | Hub / spoke | Certified metrics (MetricFlow) — primary KPI path |

Executors and Gemma planner are **internal** — not exposed as separate HTTP routes.

---

## Package layout

```text
sql_agent/
├── super.py                 # execute_sql_query entry
├── errors.py                # SqlAgentError, WarehouseUnavailableError
├── job.py                   # SqlQueryRequest, ExecutorJob
├── agent_policy.py          # list-only, KPI heuristics
├── catalog_loader.py        # get_table, load_product_catalog
├── compiled_catalog.py      # load_compiled_catalog
├── db.py                    # Postgres + ClickHouse execute
├── validator.py             # read-only SQL guard
├── metric_fallback.py       # certified template execute
├── router.py                # entityHint → product/table
├── mas/
│   ├── super_planner.py     # Gemma + regex fallback
│   ├── orchestrator.py      # execute_plan
│   ├── harness.py           # guardrails
│   ├── cross_product.py     # SKU matrix
│   └── gemma_client.py      # LLM client
├── executors/               # per-product execute_job
├── presets/catalog.yml      # preset definitions
├── kpi_templates/           # per-product certified SQL
└── catalog/
    ├── compiled/            # warehouse-introspected YAML
    └── sources/             # hand-maintained fallback
```

Legacy import path: `semantic/sql/__init__.py` re-exports `execute_sql_query`, `SqlAgentError`.

---

## Related docs

- [TICKETING_CONTEXT_LAYER_INTEGRATION.md](TICKETING_CONTEXT_LAYER_INTEGRATION.md) — Ticketing spoke contract (§4 SQL Super)
- [SEMANTIC_LAYER.md](SEMANTIC_LAYER.md) — MetricFlow / semantic query path
- [ONTOLOGY_AND_SEMANTIC_LAYER.md](ONTOLOGY_AND_SEMANTIC_LAYER.md) — ontology + semantic overview
- [ARCHITECTURE.md](ARCHITECTURE.md) — repo layout
- [api/README.md](../api/README.md) — HTTP reference
