# Workflow — How This Setup Works

Simple map of the ontology + semantic layer: what talks to what, and which files you touch when something changes.

**Operations playbook (add org, metrics, dims, agent allowlists):** [SEMANTIC_LAYER_OPERATIONS_WORKFLOW.md](SEMANTIC_LAYER_OPERATIONS_WORKFLOW.md)

**Architecture guides:** [ONTOLOGY.md](ONTOLOGY.md) (motive + slice), [SEMANTIC_LAYER.md](SEMANTIC_LAYER.md) (warehouse mesh + query).

**Context control plane (entitlements + role-packed metrics):** see [Context control plane](#context-control-plane) below.

---

## 30-second picture

```
Spoke agent (CRM, Ticketing, CC, …)
        │
        ▼
   Context Layer API  (port 8765)
        │
        ├── POST /v1/ontology/slice  →  "What may I talk about?"  (types, actions, metric ids)
        │
        └── POST /v1/semantic/query  →  "What is the number?"     (MetricFlow → Postgres)
```

- **Ontology** = meaning (YAML in Git). No SQL, no live customer rows.
- **Semantic layer** = numbers (dbt + MetricFlow on Postgres).
- **Tenant overlay** = per-org labels, synonyms, thresholds.

Agents get a **compact prompt** from the slice. When they need KPIs, they call semantic query with **metric ids from that prompt**.

---

## Two flows

### Flow A — Ontology slice (every agent turn or cached per deploy)

1. Spoke sends: `organizationId`, `agent`, `product` (Hub sends `products[]`).
2. API loads:
   - `ontology/agents.yml` → which modules/preset for this agent
   - `ontology/catalog.yml` → preset allowlists (compact prompt)
   - `ontology/modules/*.yml` → types, relations, actions, metric ids
   - `ontology/industry/{pack}.yml` → labels (Patient vs Buyer)
   - `tenants/org{id}/semantic.yaml` → synonyms, binds
   - `tenants/org{id}/org{id}_metrics.yaml` → thresholds only
   - `ontology/metric_policies.yml` → when to use each metric, scope, group_by hints
3. `ontology/slice.py` merges everything → returns `prompt` string.

**No database needed for the slice itself** (except optional scope lookup on semantic path).

### Flow B — Semantic query (when agent asks for a KPI)

1. Spoke sends: `organizationId`, `userId`, `product`, `agent`, `metrics[]`, optional `group_by`, `time`.
2. `semantic/query.py`:
   - Re-fetches slice → **allowlist**: agent may only use metrics in its prompt
   - `semantic/metric_registry.yml` → metric id is **certified**
   - `semantic/scope.py` → row filter (agent sees own tickets/deals, admin sees more)
   - `semantic/metricflow/engine.py` → compile SQL from dbt manifest
3. SQL runs on **Postgres** (warehouse marts from dbt).

---

## File layers (bottom to top)

| Layer | Folder / file | What it holds | Loaded when |
|-------|----------------|---------------|-------------|
| **Warehouse source** | Postgres `ticketing.*`, `crm.*`, … | Raw tables | dbt reads |
| **dbt staging/marts** | `semantic/dbt/{product}/default/dbt/models/` | Clean views (`stg_tickets`, `mart_tickets`, …) | `dbt run` |
| **MetricFlow YAML** | `.../models/semantic_layer/semantic_layer.yml` | Measures, metrics, dimensions | `dbt parse` |
| **Metric registry** | `semantic/metric_registry.yml` | Agent-safe metric **ids** (353 certified) | API / tests |
| **Ontology modules** | `ontology/modules/*.yml` | Business types, actions, metric id lists | Every slice |
| **Policies** | `ontology/metric_policies.yml` | Scope, when/not, dim hints | Slice + query |
| **Catalog / presets** | `ontology/catalog.yml` | Compact allowlists per preset | Slice |
| **Agents index** | `ontology/agents.yml` | Agent → modules/preset + `owned_product` | Slice |
| **Industry** | `ontology/industry/*.yml` | Vertical labels + taxonomy | Slice (via tenant pack) |
| **Tenant** | `tenants/org{id}/semantic.yaml` | Synonyms, labels, binds | Slice |
| **Org KPIs** | `tenants/org{id}/org{id}_metrics.yaml` | Thresholds (warn/critical) | Slice prompt |
| **Reference KG (removed)** | — | Was `existing onto/core.yaml` | **Not loaded**; runtime uses `ontology/modules/` |

---

## Dependency chain (what depends on what)

```
Postgres tables
    └── dbt staging SQL (stg_*.sql)
            └── dbt marts (mart_*.sql)
                    └── semantic_layer.yml (measures + metrics)
                            └── dbt parse → target/manifest.json + semantic_manifest.json
                                    └── MetricFlow engine (semantic/metricflow/)
                                            └── POST /v1/semantic/query

ontology/modules/*.yml
    └── catalog.yml (presets point at modules + prompt allowlists)
            └── agents.yml (agent → preset or modules)
                    └── slice.py
                            └── POST /v1/ontology/slice

generate_metric_registry.py reads semantic_layer.yml
    └── semantic/metric_registry.yml
            └── semantic/lookup.py (certify metric id)

metric_policies.yml + slice allowlist
    └── semantic/query.py (reject unknown / disallowed metrics)
```

**Rule of thumb:**

- Change **numbers/formulas** → dbt side.
- Change **what agents may say or request** → ontology side.
- Change **wording per org** → tenant YAML.

---

## When you change X, do Y

| You change… | Also do… | Reload caches? |
|-------------|----------|----------------|
| `ontology/modules/*.yml`, industry packs | Nothing else | No (read from disk each slice) |
| `tenants/org{id}/semantic.yaml` or `org{id}_metrics.yaml` | Nothing else | No (read each request) |
| `catalog.yml`, `agents.yml`, `taxonomy.yml` | — | **Yes** — `POST /v1/admin/reload` or restart API |
| `metric_policies.yml`, `metric_thresholds.yml` | — | **Yes** — reload endpoint or restart |
| `semantic_layer.yml` (metric definition) | `dbt parse` (+ `dbt run` if mart SQL changed) | **Yes** after parse |
| `stg_*.sql` or `mart_*.sql` | `dbt run` → `dbt parse` | **Yes** after parse |
| New metric in dbt | `generate_metric_registry.py` → `generate_metric_thresholds.py` → module + preset + policies | **Yes** after parse |
| Catalog / joins for SQL agent | `generate_semantic_catalog.py` | No (not loaded by API runtime) |
| `.env` (Postgres host) | `dbt_parse_all.py` (rewrites profiles) | **Yes** — restart API |

**Warehouse deploy:**

```bash
PYTHONPATH=. python3 scripts/dbt_parse_all.py   # compile manifests
PYTHONPATH=. python3 scripts/dbt_run_all.py     # build staging + marts (all Postgres products)
```

**After dbt or cached YAML change:** reload without full restart (when `CONTEXT_RELOAD_SECRET` is set):

```bash
export CONTEXT_RELOAD_SECRET=your-secret   # once per env
./scripts/reload_context_layer.sh
```

Or restart `./scripts/run_context_layer_api.sh` (`MF_WARM=1` warms engines on startup).

**No uvicorn `--reload`:** saving a file does not restart the process. Reload is explicit after you finish editing.

---

## Overlay order (how one prompt is built)

1. **Modules** — union selected modules + `depends_on`; `core` always included
2. **Industry pack** — from tenant `industryPack` (e.g. healthcare, ecommerce)
3. **Tenant `semantic.yaml`** — labels, synonyms
4. **Org metrics file** — org-specific threshold overrides (not in prompt)

Same **metric ids** everywhere; industry/org change **words**; **thresholds return on semantic query** (`interpretation` block).

---

## API entry points

| File | Role |
|------|------|
| `api/main.py` | HTTP routes, startup warmup |
| `scripts/run_context_layer_api.sh` | Start uvicorn on port 8765 (no `--reload`) |
| `scripts/reload_context_layer.sh` | Clear caches + re-warm MetricFlow on running API |
| `semantic/runtime_reload.py` | Shared reload logic for admin endpoint |
| `ontology/slice.py` | Core slice compiler |
| `semantic/query.py` | Validate + execute metrics |
| `semantic/metricflow/engine.py` | Cache MetricFlow engines per product |

---

## Tests (smoke check)

| Script | What it checks |
|--------|----------------|
| `scripts/test_semantic_dim_resolve.py` | Dims, scope, org WHERE (no warehouse) |
| `scripts/test_metric_thresholds.py` | Registry ↔ platform thresholds; interpretation |
| `scripts/test_industry_org_metrics.py` | Tenant overlays, noun_map |
| `scripts/test_semantic_products.py` | Live API + Postgres per product |
| `scripts/test_spoke_context_layer.py` | Full slice + hub + contracts |

---

## Context control plane

Per-request packing of ontology + metrics (not per-tenant dbt forks).

| Piece | Path |
|-------|------|
| Capability tags | [`ontology/metric_capabilities.yml`](../ontology/metric_capabilities.yml) + inference in [`semantic/capabilities.py`](../semantic/capabilities.py) |
| Tenant entitlements (SoT) | Accounts DB via [`semantic/entitlements.py`](../semantic/entitlements.py); YAML `enabledSpokes` / `channels` fallback for dev |
| Resolver | [`semantic/context.py`](../semantic/context.py) — same logic for slice and query |
| Slice | `POST /v1/ontology/slice` with optional `userId` → `metrics[]`, `entitlements`, clipped `taxonomy` |
| Query enforcement | [`semantic/query.py`](../semantic/query.py) — reject non-visible metrics; inject entitled `channel IN (...)` |

**New tenant:** subscriptions + channels in accounts; optional `tenants/org{id}/` for labels/thresholds only.

**Postgres warehouse Mesh:** [`semantic/dbt/postgres/README.md`](../semantic/dbt/postgres/README.md) (staging/marts consolidation target).

---

## Common gotchas

- **Port 8765** — not 8080 (often another app there).
- **Open tickets** = `status = open` only (not pending/overdue).
- **Win rate** — don't `group_by: stage` on ratio metrics.
- Legacy `existing onto/core.yaml` was removed; runtime uses `ontology/modules/`.
- **No file-watch reload** — use `POST /v1/admin/reload` or restart API after `dbt parse` / cached YAML edits.

---

## One-line summary

**YAML defines what agents may mean and measure; dbt defines how numbers are computed; the API builds a compact prompt and returns KPI values with org-aware thresholds in `interpretation` on `/v1/semantic/query`.**

## Semantic catalog (SQL agent dependency)

- **Generate:** `python3 scripts/generate_semantic_catalog.py` → `semantic/catalog/{product}.yaml`
- **Joins:** `semantic/catalog/joins.yml` (allowlisted mart joins)
- **CCaaS:** semantic models reference `mart_*` views (staging is ETL-only)
- **Thresholds:** `semantic/metric_thresholds.yml` (platform) + org file overrides; regenerate via `scripts/generate_metric_thresholds.py`
