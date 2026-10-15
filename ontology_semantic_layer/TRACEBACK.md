# Traceback — ontology & context layer program of work

Chronological record of what was built, why, and where it lives. Use this to onboard or audit the repo.

---

## 1. Problem (starting point)

Two legacy artifacts were not suitable as **agent-facing** context:

| Artifact | Path | Role |
|----------|------|------|
| Neo4j table→node mapping | `onto_config/` | KG loader spec, not OWL/agent ontology |
| dbt + MetricFlow YAML | `enterprise_semantic_layer_product_wise_dbt/` | Valid semantic layer, uneven per product, not runnable as-is in repo |

**Goal:** Module YAML + per-agent slicing (`fetch_ontology_slice` → `as_prompt()`), not GraphRAG, not dumping the full graph.

---

## 2. Architecture locked

| Decision | Rule |
|----------|------|
| Customer spine | One `wt:Customer` everywhere; join on `cdp_id` + `organization_id` |
| Ticket | One `wt:Ticket` across CC and Ticketing |
| Industry | Labels + taxonomy terms (`saas_b2b`, `healthcare`, …) — no forked root types |
| Tenant | Synonyms, binds, thresholds in `tenants/org{id}/semantic.yaml` |
| Agent prompt | Compact allowlist of types, actions, **metric ids only** |
| KPI formulas | Stay in MetricFlow / dbt — never in ontology prompt |

Documented in [`docs/ENTERPRISE_CONTEXT_LAYER.md`](docs/ENTERPRISE_CONTEXT_LAYER.md).

---

## 3. v1 — Contact Centre + Ticketing

**Built:**

- [`ontology/modules/*.yml`](ontology/modules/) — core, identity, interaction, ticket, queue, workforce, hub, tk_*, …
- [`ontology/catalog.yml`](ontology/catalog.yml) — module catalog + CC/TK/Hub **presets** with prompt allowlists
- [`ontology/taxonomy.yml`](ontology/taxonomy.yml) — classification trees (channel, intent, ticket.priority, …)
- [`ontology/slice.py`](ontology/slice.py) — `fetch_ontology_slice(preset=..., modules=..., tenant=...)`
- [`ontology/industry/*.yml`](ontology/industry/) — label overlays
- [`semantic/metric_registry.yml`](semantic/metric_registry.yml) + [`semantic/lookup.py`](semantic/lookup.py)

**Legal slice vs prompt slice:**

- **Legal** = union of selected modules + `depends_on` + `core`
- **Prompt** = preset allowlist filtered compact text for the LLM

---

## 4. Postgres / data plane inspection

Read-only inspect of `worktual_bigint` (`.env` credentials):

- Tenant key: `accounts.organizations.id` → `organization_id` everywhere
- CDP spine: `cdp.customer_profile`, `cdp.identity_keys`, `cdp.customer_events`
- Schemas: `accounts`, `cdp`, `ccass`, `ticketing`, `crm`, `campaign`, …
- Webtracking: ClickHouse (CDP has `source_system=webtracking` in identity_keys)

Recorded in [`semantic/PRODUCT_DATA_PLANE.yml`](semantic/PRODUCT_DATA_PLANE.yml).  
Script: [`scripts/inspect_pg_schemas.py`](scripts/inspect_pg_schemas.py).

---

## 5. Agent inventory ingested

Agent docs mapped in [`ontology/AGENT_INVENTORY.yml`](ontology/AGENT_INVENTORY.yml):

- Contact Centre, Ticketing, CRM, Campaign, Hub, CDP

---

## 6. Tenant naming — `org1000`

**Before:** `tenants/org_worktual/`  
**After:** `tenants/org1000/` — folder = **`org` + `organization_id`** (e.g. id `1000` → `org1000`)

- [`tenants/org1000/semantic.yaml`](tenants/org1000/semantic.yaml) — labels, synonyms, binds, thresholds
- [`tenants/org1000/FETCH_EXAMPLES.md`](tenants/org1000/FETCH_EXAMPLES.md) — CLI/Python examples
- Removed `tenants/org_worktual/`

---

## 7. All-spoke expansion (approved plan)

**New modules:**

| Spoke | Modules |
|-------|---------|
| CDP | `cdp.yml` |
| CRM | `crm_account`, `crm_deal`, `crm_quote`, `crm_order`, `crm_activity`, `crm_lead`, `crm_meeting` |
| Campaign | `campaign_core`, `campaign_template`, `campaign_ops` |
| Metrics | `metrics_ccass`, `metrics_ticketing`, `metrics_crm`, `metrics_campaign`, `metrics_webtracking` (auto-generated) |

**Agent index:** [`ontology/agents.yml`](ontology/agents.yml) — agent id → modules (+ optional preset)

**Slice API extended:** `fetch_ontology_slice(agent=...)`, `list_agents()`

**Catalog:** CRM/Campaign/CDP products active; presets `crm.*`, `camp.*`; MetricFlow metric ids in CC/TK presets

**Metric registry generator:** [`scripts/generate_metric_registry.py`](scripts/generate_metric_registry.py) — **353** certified metrics from dbt YAML

**Taxonomy adds:** `identity.source_system`, `deal.stage`, `campaign.goal`, `campaign.status`

**Demo:** [`ontology/demo_org1000_fetch.py`](ontology/demo_org1000_fetch.py)

---

## 8. Spoke contract — FastAPI context layer (this step)

**Rule:** Spokes send **exactly one** of `agent` | `preset` | `modules`, plus `organizationId`.

| Component | Path |
|-----------|------|
| FastAPI app | [`api/main.py`](api/main.py) |
| API docs | [`api/README.md`](api/README.md) |
| Dependencies | [`requirements.txt`](requirements.txt) |

**Endpoints:**

- `POST /v1/ontology/slice` — main spoke call
- `GET /v1/agents`, `/v1/presets`, `/v1/modules` — discovery
- `GET /v1/metrics/{id}` — certify metric id
- `GET /health`, `/v1/version`

XOR validation is **API-only**; `slice.py` still allows combinations for CLI/library use.

---

## 9. File map (organized layout)

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the current tree. Summary:

```
ontology_semantic_layer/
├── README.md, TRACEBACK.md, requirements.txt
├── api/                         ← HTTP service (:8765)
├── ontology/                    ← meaning (agents, modules, slices, policies)
│   ├── agents.yml, catalog.yml, slice.py, modules/, slices/
│   ├── AGENT_INVENTORY.yml
│   └── reference/               ← agent catalog source MDs
├── semantic/                    ← metrics (registry, query, dbt)
│   ├── query.py, context.py, metric_registry.yml, dbt/
│   └── PRODUCT_DATA_PLANE.yml
├── docs/                        ← shared guides + archive/
├── tenants/org{id}/             ← labels, synonyms, thresholds
├── scripts/                     ← dbt, tests, generators
└── tests/fixtures/ccaas/        ← integration test JSON
```

---

## 10. How to test

**Library / CLI:**

```bash
PYTHONPATH="." python ontology/demo_org1000_fetch.py
PYTHONPATH="." python ontology/slice.py -a crm.deals --tenant org1000
```

**API:**

```bash
pip install -r requirements.txt
PYTHONPATH="." uvicorn api.main:app --port 8080
curl -X POST http://localhost:8080/v1/ontology/slice \
  -H 'Content-Type: application/json' \
  -d '{"organizationId": 1000, "agent": "crm.deals"}'
```

**Regenerate metrics after dbt changes:**

```bash
python3 scripts/generate_metric_registry.py
```

---

## 11. Known gaps (honest)

- [`ontology/agents.yml`](ontology/agents.yml) is a **starter set** — not every agent in `AGENT_INVENTORY.yml` is registered yet
- MetricFlow semantic layer is **not executed** in this repo — only metric **id** certification
- No auth on API yet — assume internal network
- Pre-rendered [`ontology/slices/*.yml`](ontology/slices/) are CI/debug snapshots, not primary runtime path

---

## 12. Version markers

| Item | Version / count |
|------|-----------------|
| Ontology catalog | `2026.09.3` in `catalog.yml` |
| Metric registry | `2026.09.3`, 353 metrics |
| Context Layer API | `1.1.0` in `api/main.py` |

---

## 13. Hub entitlement slices (2026-09)

Hub sends **active purchased products** on `POST /v1/ontology/slice`:

```json
{ "organizationId": 1008, "agent": "hub.orchestrator", "products": ["contact_centre", "crm"] }
```

- [`ontology/catalog.yml`](ontology/catalog.yml) `hub_entitlements` — spine + per-product `hub_modules` and prompt extras
- [`ontology/slice.py`](ontology/slice.py) — `products=` composes Hub union; CRM does **not** imply campaign
- [`tenants/org1008/semantic.yaml`](tenants/org1008/semantic.yaml) — fixture tenant (CCaaS + CRM)
- Specialist agents ignore `products`; dedupe via existing `_dedupe` on class/action/metric ids
- Tests: [`scripts/test_spoke_context_layer.py`](scripts/test_spoke_context_layer.py) `test_hub_entitlements`

---

## 14. Required origin products (2026-09)

Mandatory origin SKU on every slice request — spokes claim one product; Hub claims an exact list.

| Caller | Field | Rule |
|--------|-------|------|
| Spoke | `product` (string) | Required. Must match agent `owned_product` in [`ontology/agents.yml`](ontology/agents.yml) |
| Hub | `products` (list) | Required, non-empty, exact active SKUs only — no legacy omit path |

Changes:

- [`ontology/agents.yml`](ontology/agents.yml) — `owned_product` on every agent entry
- [`ontology/slice.py`](ontology/slice.py) — `normalize_product_id()`, `validate_spoke_product()`; Hub always uses `hub_entitlement_plan(products)` (no static CC+TK fallback)
- [`api/main.py`](api/main.py) v1.1.0 — Pydantic validator for Hub vs spoke field shape; passes `product` / `products` into fetch
- [`ontology/demo_org1000_fetch.py`](ontology/demo_org1000_fetch.py) — samples with required origin fields
- Docs: [`README.md`](README.md), [`api/README.md`](api/README.md)

Rejected: Hub without `products`, spoke without `product`, spoke sending `products`, Hub sending `product`, agent/product mismatch, empty Hub list, unknown SKU.

Roles/RBAC intentionally **not** in this API — same request shape supports future entitlement gateway.

---

## 15. Metric thresholds on retrieval (2026-09)

**Decision:** Thresholds belong on **query results**, not in ontology prompt text.

| Layer | File | Role |
|-------|------|------|
| Platform defaults | [`semantic/metric_thresholds.yml`](semantic/metric_thresholds.yml) | One row per certified metric id (353 total) |
| Generator | [`scripts/generate_metric_thresholds.py`](scripts/generate_metric_thresholds.py) | Heuristic bands from registry + metric name patterns |
| Merge + status | [`semantic/thresholds.py`](semantic/thresholds.py) | `merge_threshold()`, `build_interpretation()`, `evaluate_status()` |
| Org overlay | `tenants/org{id}/org{id}_metrics.yaml` | Wins on `threshold` key only (e.g. org1000 open tickets 25/60) |
| Query response | [`semantic/query.py`](semantic/query.py) `execute()` | Adds `interpretation` block per metric |
| Admin GET | [`api/main.py`](api/main.py) `GET /v1/metrics/{id}` | Returns merged threshold metadata |

Merge order: **platform → org overlay**. Prompt slice (`ontology/slice.py`) lists metric ids + policy only — no `threshold:` lines.

Tests: [`scripts/test_metric_thresholds.py`](scripts/test_metric_thresholds.py), [`scripts/test_industry_org_metrics.py`](scripts/test_industry_org_metrics.py) (`test_org1000_thresholds_not_in_prompt`).

---

## 16. CCaaS marts + semantic retarget (2026-09)

**Before:** CCaaS MetricFlow semantic models referenced `stg_*` staging tables.  
**After:** **16** `mart_*.sql` in [`semantic/dbt/ccaas/default/dbt/models/marts/`](semantic/dbt/ccaas/default/dbt/models/marts/) with [`schema.yml`](semantic/dbt/ccaas/default/dbt/models/marts/schema.yml) (grain, tenant_column, row_scope_column).

- [`semantic_layer.yml`](semantic/dbt/ccaas/default/dbt/models/semantic_layer/semantic_layer.yml) — all `ref('stg_*')` → `ref('mart_*')`
- Primary enrichment: `mart_conversations` joins queue/agent names for reporting dims
- **Ops:** `dbt run` in CCaaS project required before MetricFlow queries succeed on marts

---

## 17. Semantic catalog for MetricFlow + future SQL agent (2026-09)

| Artifact | Purpose |
|----------|---------|
| [`scripts/generate_semantic_catalog.py`](scripts/generate_semantic_catalog.py) | Build product catalogs from marts schema + semantic YAML + registry |
| [`semantic/catalog/{product}.yaml`](semantic/catalog/) | Tables, columns, certified metrics, threshold kind/direction |
| [`semantic/catalog/joins.yml`](semantic/catalog/joins.yml) | Allowlisted mart joins (org-safe keys) for future SQL agent |

Regenerate after marts or registry changes:

```bash
PYTHONPATH=. python3 scripts/generate_semantic_catalog.py
```

SQL agent **service** is out of scope here — catalog is the dependency layer only.

---

## 18. Production readiness gate (2026-09)

Single CI entrypoint:

```bash
PYTHONPATH=. python3 scripts/test_production_readiness.py
```

Covers: registry ↔ threshold parity, prompt hygiene, CCaaS mart contract, catalog/joins sync, certified metric alignment, and subprocess runs of core unit scripts.

Optional live integration (API on `:8765`):

```bash
./scripts/run_context_layer_api.sh   # separate terminal
PYTHONPATH=. python3 scripts/test_production_readiness.py --live
```

Optional dbt compile check:

```bash
PYTHONPATH=. python3 scripts/test_production_readiness.py --dbt
```

**Still not production-hardened (honest):**

- No auth on API (body `organizationId` honor-system)
- dbt `test` / `parse` not in CI until `dbt-postgres` installed in pipeline
- ~220 platform thresholds are heuristic — review per metric before customer-facing SLA alerts
- CCaaS/ticketing marts must exist in Postgres (`dbt run`) for live semantic queries

---

## 19. dbt parse + run verified (2026-09-10)

**Parse:** 5/5 Postgres projects (shared, campaign, crm, ccaas, ticketing). Webtracking skipped (no `ch_host`).

**Run:** [`scripts/dbt_run_all.py`](scripts/dbt_run_all.py) — campaign 17, crm 55, ccaas 33, ticketing 35 models — all PASS.

**Fixes during deploy:**

| Issue | Fix |
|-------|-----|
| CRM parse fail | Removed duplicate `mart_contact_campaign_engagement` from `staging/schema.yml` (canonical entry in `marts/schema.yml`) |
| CCaaS `group_by: channel` HTTP 400 | YAML 1.1 parsed `on:` as boolean `True` in `metric_policies.yml` → quoted `"on":`; normalize in [`semantic/lookup.py`](semantic/lookup.py) |

**Live MetricFlow (org1000, direct `execute()`):** CRM, CCaaS, Ticketing, Campaign — all return rows + `interpretation`.

**Ops commands:**

```bash
export PATH="$HOME/miniconda3/bin:$PATH"   # or any env with dbt-postgres
PYTHONPATH=. python3 scripts/dbt_parse_all.py
PYTHONPATH=. python3 scripts/dbt_run_all.py
export CONTEXT_RELOAD_SECRET=...           # optional: reload without full restart
./scripts/reload_context_layer.sh          # or restart run_context_layer_api.sh
```

---

## 20. Controlled cache reload (2026-09-10)

**Problem:** No uvicorn `--reload` (saving mid-edit must not bounce MetricFlow). Cached layers (catalog, policies, engines) otherwise need full process restart.

**Solution:**

| Piece | Path |
|-------|------|
| Reload logic | [`semantic/runtime_reload.py`](semantic/runtime_reload.py) |
| Admin route | `POST /v1/admin/reload` in [`api/main.py`](api/main.py) |
| CLI | [`scripts/reload_context_layer.sh`](scripts/reload_context_layer.sh) |
| Tests | [`scripts/test_runtime_reload.py`](scripts/test_runtime_reload.py) |

Header: `X-Reload-Secret: $CONTEXT_RELOAD_SECRET`. Endpoint returns **404** when secret env is unset.

---

## 21. Context control plane (2026-09-11)

**Goal:** Per-request metric packing via capabilities + accounts entitlements + role — same resolver for slice and query. Postgres warehouse Mesh consolidation is a separate phase.

**Delivered (Phases 1–2):**

| Piece | Path | Status |
|-------|------|--------|
| Capability catalog | [`ontology/metric_capabilities.yml`](ontology/metric_capabilities.yml), [`semantic/capabilities.py`](semantic/capabilities.py) | Done |
| Resolver | [`semantic/context.py`](semantic/context.py) — `resolve_context()`, `filter_metrics()` | Done |
| Entitlements adapter | [`semantic/entitlements.py`](semantic/entitlements.py) — DB SoT, YAML/dev fallback, `intersect_hub_products()` | Done |
| Slice wire | [`ontology/slice.py`](ontology/slice.py) + [`api/main.py`](api/main.py) — optional `userId`, `metrics[]`, `entitlements`, clipped taxonomy | Done |
| Query enforcement | [`semantic/query.py`](semantic/query.py) — same allowlist; `channel IN (...)` inject for `channel_scoped` | Done |
| CDP product alias | [`semantic/scope.py`](semantic/scope.py) — `cdp` → `cdp` (not `crm`) | Done |
| Registry duplicate guard | [`scripts/generate_metric_registry.py`](scripts/generate_metric_registry.py) — fails on cross-domain id collision | Done |
| Unit tests | [`scripts/test_context_resolver.py`](scripts/test_context_resolver.py) — 11 cases (2-channel, agent vs supervisor, hub intersect) | Done |
| Ops docs | [`docs/WORKFLOW.md`](docs/WORKFLOW.md) — Context control plane section | Done |

**Also delivered (Phases 3–5, 2026-09-11):**

| Piece | Path | Status |
|-------|------|--------|
| Postgres warehouse Mesh | [`semantic/dbt/postgres/default/dbt/`](semantic/dbt/postgres/default/dbt/) — staging/marts moved; domain packages semantic-only | Done |
| Parse / run scripts | [`scripts/dbt_parse_all.py`](scripts/dbt_parse_all.py), [`scripts/dbt_run_all.py`](scripts/dbt_run_all.py) | Done |
| Multi-source registry | [`scripts/generate_metric_registry.py`](scripts/generate_metric_registry.py) — `sources:` for cross-domain ids (`resolution_rate`, etc.) | Done |
| Engine routing | [`semantic/capabilities.py`](semantic/capabilities.py) `resolve_execution_product()` → [`semantic/query.py`](semantic/query.py) + [`semantic/metricflow/engine.py`](semantic/metricflow/engine.py) | Done |
| Query / routing tests | [`scripts/test_query_engine_routing.py`](scripts/test_query_engine_routing.py) — channel inject, engine, product mismatch | Done |

**Follow-on (out of plan scope):**

| Piece | Notes |
|-------|-------|
| CDP contact-grain package | Per plan §10.5 — not started |
| Live API channel-inject test | Unit coverage exists; optional live integration |

**Verify:**

```bash
PYTHONPATH=. python3 scripts/test_context_resolver.py   # 11 passed
export ENTITLEMENTS_DEV_FALLBACK=1                      # local when accounts DB empty
./scripts/reload_context_layer.sh                       # after capability/policy edits
```

**Docs (2026-09-11):** [`docs/ONTOLOGY.md`](docs/ONTOLOGY.md) (motive + slice), [`docs/SEMANTIC_LAYER.md`](docs/SEMANTIC_LAYER.md) (mesh + why domain dbt folders remain). README updated to point here.

---

## 22. Repository cleanup (2026-09-11)

**Removed:** `vibecoding_files/` (reference copies of spoke repos), `existing onto/`, `existing semantic layer/`, `semantic/dbt/shared/`, root chat JSON + zip, dbt `target/`/`logs/`/`dbt_packages/` artifacts, one-time `migrate_postgres_mesh.sh`.

**Reorganized:**

| From | To |
|------|-----|
| Agent catalogs, `AGENT_INVENTORY.yml` | `ontology/` + `ontology/reference/` |
| `PRODUCT_DATA_PLANE.yml` | `semantic/` |
| Cross-cutting design docs | `docs/` |
| Chat exports, evaluation reports | `docs/archive/` |
| `ccaas_*_results.json`, stress test JSON | `tests/fixtures/ccaas/` |
| `ontology/slices/` | Kept under ontology (compiled preset dumps — not runtime) |

**Added:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — canonical folder map. Expanded [`.gitignore`](.gitignore) for dbt artifacts and secrets.
