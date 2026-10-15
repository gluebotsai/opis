# Handoff: Ontology & Semantic Layer — Full Chat Context

**Purpose:** Give a new chat session complete context on what was built, discussed, decided, and left open in this workstream.  
**Workspace:** `/home/vectone/Uday/ontology_semantic_layer`  
**User:** Velmurugan (Software engineer)  
**Last updated:** 2026-09-10  

---

## 1. What this project is

Worktual **ontology + semantic layer** for a multi-spoke B2B SaaS platform:

| Spoke | Agent prefix | Domain |
|-------|--------------|--------|
| Contact Centre (CCaaS) | `cc.*` | Conversations, queues, WFM, reporting |
| Ticketing | `tk.*` | Tickets, KB, teams, proactive/ASGA |
| CRM | `crm.*` | Deals, accounts, leads |
| Campaign | `camp.*` | Campaigns, delivery, attribution |
| Hub | `hub.*` | Cross-spoke orchestration |
| CDP | — | Customer spine, identity |

**Design principles (agreed):**

- Agents get **metric ids**, not SQL or live row data.
- **One canonical type** per concept (`wt:Customer`, `wt:Ticket`) — industry changes **labels**, not ids.
- **Legal slice** (full module union) vs **prompt slice** (allowlisted compact text for LLM).
- Metric **formulas** live in MetricFlow/dbt; ontology lists **certified ids** + policy (`when` / `not_for`).

---

## 2. HTTP API (Context Layer)

**Port:** 8765 (default)  
**Start:** `./scripts/run_context_layer_api.sh` (uses `python3 -m uvicorn`, not bare `uvicorn`)

| Endpoint | Caller | Purpose |
|----------|--------|---------|
| `POST /v1/ontology/slice` | Spokes | Compact ontology for one agent + `product` |
| `POST /v1/ontology/hub` | Hub | Product map from entitled `products[]` |
| `POST /v1/semantic/query` | Any agent | MetricFlow execute (certify + allowlist + row scope) |
| `GET /health` | Ops | Status + MetricFlow warm state |

**Spoke slice body (exactly one of agent / preset / modules + required `product`):**

```json
{
  "organizationId": 1000,
  "agent": "crm.deals",
  "product": "crm"
}
```

**Hub body (no agent; exact SKU list — no auto-expansion):**

```json
{
  "organizationId": 1008,
  "products": ["contact_centre", "crm"]
}
```

**Semantic query body:**

```json
{
  "organizationId": 1000,
  "userId": 1000,
  "product": "crm",
  "agent": "crm.deals",
  "metrics": ["won_deal_rate"],
  "group_by": ["stage"],
  "time": { "start": "2026-01-01", "end": "2026-09-09", "grain": "day" }
}
```

**Key docs:** [`README.md`](../../README.md), [`api/README.md`](../../api/README.md), [`ontology/reference/ONTOLOGY_ARCHITECTURE.md`](../../ontology/reference/ONTOLOGY_ARCHITECTURE.md), [`ARCHITECTURE.md`](../ARCHITECTURE.md)

---

## 3. Two different “cores” (critical distinction)

| Artifact | Role | Loaded at runtime? |
|----------|------|-------------------|
| [`ontology/modules/core.yml`](../ontology/modules/core.yml) | Foundation types for every agent slice | **Yes** — `catalog.yml` `always: true` |
| `existing onto/core.yaml` *(removed)* | Was full KG spec (~150 Postgres tables) | **No** — not imported; runtime uses `ontology/modules/` |

**User’s intent:** `existing onto/core.yaml` is the **authoritative ontology they created** (graph/warehouse design).

**Runtime reality:** Agents use `ontology/modules/*.yml` compiled by [`ontology/slice.py`](../ontology/slice.py). Alignment with `core.yaml` is via comments + [`ontology/noun_map.yml`](../ontology/noun_map.yml) (reference + CI), not automatic compile.

**Naming drift examples:**

| `core.yaml` label | Agent layer id |
|-------------------|----------------|
| `Opportunity` | `wt:Deal` |
| `SupportCase` | `wt:Ticket` |
| `MessageDelivery` | `wt:MessageDelivery` |

**Industry domain files** (`existing onto/saas.yaml`, `ecommerce.yaml`) describe `effective(org) = core.yaml + domains/<industry>.yaml + org overlay` — that composition is **not** wired to the agent API; agents use `ontology/industry/*.yml` + `tenants/org{id}/semantic.yaml`.

---

## 4. Overlay order (how context is composed)

Documented in [`tenants/org1000/FETCH_EXAMPLES.md`](../tenants/org1000/FETCH_EXAMPLES.md):

1. **Modules** — union + `depends_on`; **`core` always included**
2. **Industry pack** — from tenant `industryPack` (e.g. `healthcare`, `ecommerce`, `saas_b2b`): labels + extra taxonomy terms
3. **Tenant `semantic.yaml`** — labels, **synonyms** (spoken words → `wt:*`), binds, policies
4. **Org metrics `org{id}_metrics.yaml`** — **thresholds only** (formulas stay in MetricFlow base)

**Two CCaaS tenants (healthcare vs ecommerce):** Same agent code; different `industryPack` in tenant folder → Patient vs Buyer labels, different intent/ticket taxonomy terms. **Do not fork** `wt:Customer`.

---

## 5. Work completed in this chat (implementation)

### 5.1 Metric scope, org isolation, formula fixes

**Scope & row filters** ([`semantic/scope.py`](../semantic/scope.py), [`ontology/metric_policies.yml`](../ontology/metric_policies.yml)):

| Product / metric grain | Human agent filter entity |
|------------------------|---------------------------|
| CRM deal KPIs | `deal__owner` |
| Ticketing KPIs | `ticket__assignee` |
| CCaaS conversations | `conversation__agent` |
| CCaaS AHT / missed contact | `assignment__agent` |
| CCaaS `sla_breach_rate` | org-only (no agent on SLA state) |
| Campaign / MQL | org only |

**Org WHERE (fail-closed):** [`semantic/metricflow/engine.py`](../semantic/metricflow/engine.py) — always prepend `organization_id = '{org}'`; missing tenant dim → error, no silent unscoped SQL.

**dbt / formula changes (parse done; warehouse may need `dbt run`):**

- Ticketing `sla_breach_rate` denominator → SLA-eligible tickets (`tickets_with_resolution_sla_target_metric`)
- High-priority open: `is_open` + priority in `high`, `urgent`, `p1`
- Status: `lower()` on overdue/reopened in mart; open = **status open only** (not pending)
- CCaaS AHT: `completed_leg_count` uses `is_completed_leg`

**Tests:** [`scripts/test_semantic_dim_resolve.py`](../scripts/test_semantic_dim_resolve.py) — 16/16 pass (dims + scope + org WHERE).

### 5.2 MetricFlow warmup on API start

- [`semantic/metricflow/engine.py`](../semantic/metricflow/engine.py): `warmup_engines()` for crm, ccaas, ticketing, campaign
- [`api/main.py`](../api/main.py): FastAPI lifespan runs warmup before accepting traffic when `MF_WARM=1` (default)
- [`scripts/run_context_layer_api.sh`](../scripts/run_context_layer_api.sh): sets `MF_WARM=1`
- `/health` includes `metricflow.warm`, `failed`, `cached`
- **After `dbt parse`:** restart API so engines reload manifests (no hot reload)
- **Uvicorn:** single worker for prod; `--reload` drops cache

### 5.3 Industry, org metrics, prompt, logging (latest pass)

- **Synonyms in prompt** — “Aliases” section (e.g. `Case, Ticket -> wt:Ticket`)
- **`org1000_metrics.yaml`** — thresholds moved out of `semantic.yaml`
- **Metric prompt lines** — `group_by/filter`, `when`/`not` (thresholds on **query interpretation**, not prompt)
- **Logging:** `logs/context_layer.log` (INFO+), `logs/error.log` (ERROR+); [`api/logging_setup.py`](../api/logging_setup.py)
- **noun_map** updated + CI in [`scripts/test_industry_org_metrics.py`](../scripts/test_industry_org_metrics.py) — 6/6 pass

**Explicitly NOT done (user choice):** slice hashing, encoding, JWT/auth (Phase A skipped in plan).

---

## 6. Semantic layer behavior (important for debugging)

### 6.1 Why queries can feel slow

- Each query: ontology slice fetch, Postgres scope lookup, MetricFlow compile + SQL on remote Postgres (`10.180.0.126` in `.env`)
- **Warmup** removes first-hit dbt/MF load (~11–14s once at startup)
- Marts are **views** (live, not stale snapshots)

### 6.2 CRM win rate 0.625 vs expected 0.7

**Not a broken formula.** `won_deal_rate` = won ÷ closed is correct in YAML.

**0.625 = 5/8** because:

- **`scope: owner_or_team`** → `deal__owner IN (visible users)` (admin 1000 may see subset of owners)
- **Time filter** uses **`created_at`**, not `closed_at`
- **`group_by: stage`** on win rate is tautology (closed_won=1.0, closed_lost=0.0); org rate should **not** group by stage

Example payload that produced 0.625:

```json
{
  "organizationId": 1000,
  "userId": 1000,
  "product": "crm",
  "agent": "crm.deals",
  "metrics": ["won_deal_rate"],
  "time": { "start": "2026-01-01", "end": "2026-09-09", "grain": "day" }
}
```

### 6.3 Open tickets rule (user decision)

- **Open tickets = `status = open` only** — not pending, overdue, or reopened merged into “open”

### 6.3 Human agent visibility (user decisions)

- **CC agent:** only assigned conversations/assignments
- **Ticketing agent:** only tickets assigned to them
- **Admin/manager/supervisor:** team or org visibility (existing `visible_user_ids` logic)
- **Org 1000** must never leak other orgs’ data (org WHERE on semantic queries)

### 6.4 Campaign delivery_rate

- Documented as **send proxy** (sent ÷ touches); no delivered status in source

### 6.5 `sla_breach_rate` same id, two products

- CCaaS: conversation SLA table
- Ticketing: ticket SLA
- Policy notes differ by product; CC scope is org-only for this metric

---

## 7. dbt / MetricFlow operational rules

| Change type | Required action |
|-------------|-----------------|
| Metric YAML only | `dbt parse` + **restart API** |
| Staging/mart SQL | **`dbt run`** (or `dbt build`) + parse + restart API |
| Parse alone | Updates `target/manifest.json` — **does not** update Postgres views |

**Profiles:** [`scripts/dbt_parse_all.py`](../scripts/dbt_parse_all.py) writes `profiles/profiles.yml` from `.env`  
**Base schemas:** crm, campaign, ticketing, ccass (not `*_staging`) so MF hits live marts  
**Webtracking:** skipped if no ClickHouse in `.env`

**Ticketing SQL changes** from scope pass may still need:

```bash
cd semantic/dbt/ticketing/default/dbt
DBT_PROFILES_DIR=.../profiles dbt run --select stg_tickets mart_tickets
```

---

## 8. Key file map

| Area | Paths |
|------|--------|
| Slice compiler | [`ontology/slice.py`](../ontology/slice.py) |
| Catalog / presets | [`ontology/catalog.yml`](../ontology/catalog.yml) |
| Agents index | [`ontology/agents.yml`](../ontology/agents.yml) |
| Metric policies | [`ontology/metric_policies.yml`](../ontology/metric_policies.yml) |
| Noun map | [`ontology/noun_map.yml`](../ontology/noun_map.yml) |
| Org metrics loader | [`ontology/tenant_metrics.py`](../ontology/tenant_metrics.py) |
| Tenant overlay | [`tenants/org1000/semantic.yaml`](../tenants/org1000/semantic.yaml) |
| Org thresholds | [`tenants/org1000/org1000_metrics.yaml`](../tenants/org1000/org1000_metrics.yaml) |
| Industry packs | [`ontology/industry/`](../ontology/industry/) |
| Semantic gateway | [`semantic/query.py`](../semantic/query.py) |
| MF engine | [`semantic/metricflow/engine.py`](../semantic/metricflow/engine.py) |
| Scope | [`semantic/scope.py`](../semantic/scope.py) |
| API | [`api/main.py`](../api/main.py) |
| Tests | [`scripts/test_semantic_dim_resolve.py`](../scripts/test_semantic_dim_resolve.py), [`scripts/test_semantic_products.py`](../scripts/test_semantic_products.py), [`scripts/test_industry_org_metrics.py`](../scripts/test_industry_org_metrics.py) |
| User KG spec | `existing onto/core.yaml` *(removed — see `ontology/modules/`)* |

---

## 9. External review (Claude) — summary & our response

**Claude rated ~7/10** on agent context layer design (allowlists, metric ids, separation of concerns).

**Valid gaps called out:**

1. **`organizationId` / `products` from request body** — no JWT/mTLS; biggest security hole (**still open** — user skipped Phase A)
2. “Not a real ontology” — partially wrong: relations exist in modules + prompt; missing cardinality/IRIs
3. Single global version `2026.09.3` — no per-module semver
4. No behavioural golden evals for agents
5. Prompt string vs structured tools
6. No slice provenance (user said **no hashing**)
7. Cache by convention, no ETag
8. Ops: shell script, localhost

**Our ratings:**

- **Before industry/logging pass:** ~5/10 overall; ~6.5 as internal MAS layer
- **After industry/logging pass:** ~6.5/10 overall; ~7 as internal MAS layer
- **`core.yaml` as runtime ontology:** ~4; spec alone ~7.5
- **Ceiling without auth + compile from core.yaml:** ~7.5

---

## 10. User’s semantic layer mental model (agreed)

- **Base metrics** (leads, conversions, open tickets, AHT) — same meaning across industries; formulas in MetricFlow
- **Industry extras** — domain metrics (e.g. units sold, commission) when concept doesn’t exist in base
- **Org file** — thresholds and rare overrides; **1 Cr vs 100 Cr** = different warn/critical, **same metric ids**
- Structure: **`base + org{id}_metrics.yaml`** (industry may add certified metric ids later)
- **Thresholds, filters, group_by** should appear in agent prompt (now implemented for allowlisted metrics)
- **Knowledge graph** — optional; explains `core.yaml` hubs/collections; **not required** for CC bot vocabulary

---

## 11. Spoke integration status

- **Deferred:** Integrating into a live spoke (teams busy)
- **Can do without spokes:** API tests on org 1000, `test_semantic_products.py`, documentation, dbt run, restart API
- **cc.super prompt** for org1000 was discussed earlier: fetch `fetch_ontology_slice(agent='cc.super', tenant='org1000', product='ccaas').as_prompt()`

---

## 12. Agent / preset reference (examples)

| Use case | Agent / preset | Product param |
|----------|----------------|---------------|
| CRM deals | `crm.deals` | `crm` |
| Ticketing | `tk.tickets`, `tk.admin` | `ticketing` |
| CC reporting | `cc.reporting` | `ccaas` |
| Campaign | `camp.reports` | `campaign` |
| Hub | `hub.orchestrator` | `products[]` only |

Slice format: default `prompt`; also `debug`, `verbose`, `json` (structured slice in `json`).

---

## 13. Tests status (as of handoff)

| Script | Result |
|--------|--------|
| `scripts/test_semantic_dim_resolve.py` | 16/16 pass |
| `scripts/test_industry_org_metrics.py` | 6/6 pass |
| `scripts/test_semantic_products.py` | 8 queries (needs API + `.env` Postgres) |
| `scripts/test_spoke_context_layer.py` | E2E against localhost:8765 |

---

## 14. Known gaps / not implemented

- API authentication / signed tenant + SKU claims
- Hot reload of MetricFlow after `dbt parse` (must restart API)
- Compile `ontology/modules` from `existing onto/core.yaml`
- Industry-specific MetricFlow metrics (ecommerce units_sold, real estate commission) — slots only
- Per-module semver + deprecation CI
- Golden behavioural evals per agent
- ETag / If-None-Match on slice
- `format=tools` (JSON Schema for actions)
- Graph loader / Neo4j for `core.yaml`
- Container / production deploy URL
- `dbt run` for ticketing mart SQL (may be pending on warehouse)
- Second real tenant with full `org{id}_metrics.yaml` (only org1000 has thresholds file)

---

## 15. Environment notes

- `.env`: `pg_host`, `pg_port`, `pg_user`, `pg_pass`, `pg_db` for Postgres + dbt profiles
- `MF_WARM=0` skips MetricFlow warmup
- `MF_WARM_ORG` defaults to `1000` for warmup manifest resolution
- `DBT_PROFILES_DIR` → `profiles/`
- Logs: `logs/` (gitignored)

---

## 16. Plans created in Cursor (reference)

| Plan | Topic | Status |
|------|-------|--------|
| `metric_scope_and_formulas_65162fe1` | Scope entities, org WHERE, formulas | Implemented |
| `warm_metricflow_on_start_2f7ef9cc` | MF warmup on startup | Implemented |
| `industry_org_metrics_logs_83ebed5f` | Industry synonyms, org metrics file, logging | Implemented |

---

## 17. One-paragraph “where we stand”

We have a **working Context Layer API** (ontology slice + Hub + semantic query) with **certified metrics**, **agent allowlists**, **row scope** (owner/assignee/agent), **fail-closed org filters** on queries, **MetricFlow warmup**, **industry packs** (healthcare/ecommerce language), **platform + org metric thresholds on query interpretation** (`interpretation` block + `GET /v1/metrics/{id}`), **richer metric lines in prompts**, **semantic catalog YAML** for future SQL agent, and **file logging**. The **authoritative graph ontology** in `existing onto/core.yaml` is **not loaded at runtime**; agents use a **parallel but aligned** `wt:*` module system. **Security is still honor-system** (body org id). **Spoke integration is waiting** on product teams. **Next work** is in [`ROADMAP_ENHANCEMENTS.md`](../ROADMAP_ENHANCEMENTS.md).
