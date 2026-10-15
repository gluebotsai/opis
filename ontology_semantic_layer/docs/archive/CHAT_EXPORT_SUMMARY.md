# Ontology & Semantic Layer — Chat Export Summary

**Use this file with `@Files` in a new Cursor chat to restore context.**

| Item | Value |
|------|--------|
| **Original chat title** | Ontology and semantic layer design |
| **Export file** | `cursor_chat_ontology_and_semantic_layer_desi.json` (Cursor native export v1) |
| **Workspace** | `/home/vectone/Uday/ontology_semantic_layer` |
| **User** | Velmurugan |
| **Last updated** | 2026-09-10 |

**Deeper references (already in repo):**

- [`HANDOFF_CHAT_CONTEXT.md`](HANDOFF_CHAT_CONTEXT.md) — full implementation history, API payloads, debugging notes
- [`ROADMAP_ENHANCEMENTS.md`](ROADMAP_ENHANCEMENTS.md) — prioritized backlog (P0–P3)
- [`TRACEBACK.md`](../TRACEBACK.md) — chronological build log
- [`README.md`](../README.md) — spoke integration guide

---

## 1. What Worktual is building

Worktual is an AI-native B2B SaaS platform with **hub-and-spoke** products:

| Spoke | Agent prefix | Domain |
|-------|--------------|--------|
| Contact Centre (CCaaS) | `cc.*` | Conversations, queues, WFM, reporting |
| Ticketing | `tk.*` | Tickets, KB, teams, proactive |
| CRM | `crm.*` | Deals, accounts, leads |
| Campaign | `camp.*` | Campaigns, delivery, attribution |
| Hub | `hub.*` | Cross-spoke orchestration |
| CDP | — | Customer spine (`cdp_id` + `organization_id`) |

**Core problem solved:** Each MAS agent must get a **deterministic, compact** slice of meaning — types, actions, certified metric **ids** — not the full graph, not SQL, not live customer rows.

---

## 2. Architecture decisions (from the design chat)

### Ontology storage

| Decision | Rationale |
|----------|-----------|
| **Git YAML modules**, not Neo4j/GraphRAG for agent context | Deterministic; no fuzzy retrieval of “what to give the agent” |
| **One canonical type per concept** (`wt:Customer`, `wt:Ticket`) | Industry changes **labels**, not ids |
| **Legal slice** vs **prompt slice** | Union of modules for policy; preset allowlist for LLM prompt |
| **Modules + presets + agents.yml** | Agents fetch by `agent` id; presets define compact allowlists |
| **`existing onto/core.yaml` is authoritative KG spec** | ~150 Postgres tables → graph design; **not loaded at runtime** today |
| **Runtime uses `ontology/modules/*.yml`** | Aligned via `noun_map.yml` + comments, not auto-compile |

### Semantic layer

| Decision | Rationale |
|----------|-----------|
| **Formulas in MetricFlow/dbt only** | Ontology lists certified metric ids + `when`/`not_for` policies |
| **Meilisearch RAG replaced** | Ontology → metric id → `POST /v1/semantic/query` (deterministic) |
| **Row scope via `userId`** | Agent sees own deals/tickets/conversations; admin sees team/org |
| **Fail-closed org filter** | Every query prepends `organization_id`; missing dim → error |
| **Industry = labels + taxonomy**, not forked types | Healthcare “Patient” vs ecommerce “Buyer” on same `wt:Customer` |
| **Org file = thresholds only** | Same metric ids; 1 Cr vs 100 Cr orgs differ in warn/critical |
| **Hub sends exact `products[]`** | No auto-expansion (CCaaS ≠ ticketing; CRM ≠ campaign) |

### Explicitly deferred (user choice)

- JWT / API auth (Phase A)
- Slice hashing / encoding
- Spoke integration (teams busy)
- Compile runtime modules from `core.yaml` (future P2)
- Neo4j graph loader

---

## 3. What exists in this repo today

### Context Layer API (port **8765**)

```bash
./scripts/run_context_layer_api.sh
curl http://localhost:8765/health
```

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/ontology/slice` | Compact ontology prompt for spoke or Hub |
| `POST /v1/ontology/hub` | Product map from entitled `products[]` |
| `POST /v1/semantic/query` | MetricFlow execute (certify + allowlist + scope) |
| `GET /health` | Status + MetricFlow warm state |

**Spoke body example:**

```json
{
  "organizationId": 1000,
  "agent": "crm.deals",
  "product": "crm"
}
```

**Hub body example:**

```json
{
  "organizationId": 1008,
  "agent": "hub.orchestrator",
  "products": ["contact_centre", "crm"]
}
```

### Implementation completed in the old chat

1. **Metric scope & org isolation** — `semantic/scope.py`, `ontology/metric_policies.yml`, org WHERE in `semantic/metricflow/engine.py`
2. **dbt formula fixes** — ticketing SLA denominator, open tickets = `status open` only, CCaaS AHT legs
3. **MetricFlow warmup on startup** — `MF_WARM=1`; restart API after `dbt parse`
4. **Industry packs** — synonyms in prompt (“Aliases” section)
5. **Org metrics file** — `tenants/org1000/org1000_metrics.yaml` (thresholds separated from `semantic.yaml`)
6. **Richer metric lines in prompt** — group_by, when/not, org thresholds
7. **Logging** — `logs/context_layer.log`, `logs/error.log`
8. **Hub entitlements** — exact `products[]`, deduped shared types
9. **353 certified metrics** in `semantic/metric_registry.yml`

### Tests (as of handoff)

| Script | Status |
|--------|--------|
| `scripts/test_semantic_dim_resolve.py` | 16/16 pass |
| `scripts/test_industry_org_metrics.py` | 6/6 pass |
| `scripts/test_semantic_products.py` | Needs API + `.env` Postgres |
| `scripts/test_spoke_context_layer.py` | E2E against localhost:8765 |

### Overlay composition order

1. Modules (union + `depends_on`; `core` always included)
2. Industry pack (`ontology/industry/{pack}.yml` from tenant `industryPack`)
3. Tenant `tenants/org{id}/semantic.yaml` (labels, synonyms, binds)
4. Org thresholds `tenants/org{id}/org{id}_metrics.yaml`

---

## 4. Two “cores” — do not confuse

| Artifact | Role | Runtime? |
|----------|------|----------|
| `ontology/modules/core.yml` | Foundation types for every slice | **Yes** |
| `existing onto/core.yaml` | Full KG: tables → labels, hubs, collections, entitlement | **No** |

Naming drift examples: `Opportunity` (core.yaml) ↔ `wt:Deal` (agent layer); `SupportCase` ↔ `wt:Ticket`.

---

## 5. Operational rules (easy to forget)

| Change | Action |
|--------|--------|
| Metric YAML only | `dbt parse` + **restart API** |
| Staging/mart SQL | **`dbt run`** + parse + restart API |
| Win rate queries | Do **not** `group_by: stage` on ratio metrics |
| Open tickets | **`status = open` only** (not pending/overdue/reopened) |
| CRM win rate 0.625 vs 0.7 | Scope + time on `created_at`, not broken formula |
| Port 404 HTML | Wrong service on port — use **8765**, not 8080 |

**Ticketing views may still need:**

```bash
PYTHONPATH=. python3 scripts/dbt_parse_all.py
cd semantic/dbt/ticketing/default/dbt
DBT_PROFILES_DIR=<repo>/profiles dbt run --select stg_tickets mart_tickets
./scripts/run_context_layer_api.sh
```

---

## 6. What we need next (from roadmap)

### P0 — Before production spokes

| ID | Task |
|----|------|
| P0.1 | Run `dbt run` for ticketing marts; verify metrics on org1000 |
| P0.2 | Second tenant template (`org2000` ecommerce example) |
| P0.3 | Spoke integration pack in `api/README.md` (curl + cache + pitfalls) |
| P0.4 | Monitor `logs/error.log` weekly |

### P1 — Reach ~7.5 without auth

| ID | Task |
|----|------|
| P1.1 | noun_map CI on every ontology PR |
| P1.2 | One industry-specific certified metric (ecommerce pilot) |
| P1.3 | Metric synonyms in prompt; default filter hints in org file |
| P1.4 | Optional in-process slice cache |
| P1.5 | `POST /v1/admin/reload-metricflow` or mtime-based reload |
| P1.6 | Agent vs admin scope tests on live org1000 |

### P2 — When spokes go live

Auth (API key / JWT), compile path from `core.yaml`, ETag caching, behavioural evals, dbt CI on warehouse.

See [`ROADMAP_ENHANCEMENTS.md`](ROADMAP_ENHANCEMENTS.md) for full detail.

---

## 7. Design chat timeline (condensed)

| Phase | Topics decided |
|-------|----------------|
| **Design** | YAML modules over GraphRAG; schema not instances; compact prompts (~token budget); taxonomy as classification trees |
| **Structure** | Module catalog, presets, `fetch_ontology_slice`, industry overlays, tenant `semantic.yaml` |
| **API** | FastAPI context layer; XOR validation (one of agent/preset/modules); default `prompt` response |
| **Hub** | `products[]` entitlement; dedupe shared types; Campaign not implied by CRM |
| **Semantic** | Metric policies (`when`/`not_for`); scope by role; product-wise dbt under `semantic/dbt/` |
| **Hardening** | MF warmup, org metrics file, logging, noun_map CI, external review (~6.5–7/10 internal MAS layer) |

---

## 8. Key file map

| Area | Path |
|------|------|
| Slice compiler | `ontology/slice.py` |
| Agent index | `ontology/agents.yml` |
| Catalog / presets | `ontology/catalog.yml` |
| Metric policies | `ontology/metric_policies.yml` |
| Semantic gateway | `semantic/query.py` |
| MF engine + warmup | `semantic/metricflow/engine.py` |
| Row scope | `semantic/scope.py` |
| API | `api/main.py` |
| Tenant overlay | `tenants/org1000/semantic.yaml` |
| Org thresholds | `tenants/org1000/org1000_metrics.yaml` |
| User KG spec | `existing onto/core.yaml` |

---

## 9. One-paragraph status

We have a **working Context Layer API** (ontology slice + Hub + semantic query) with certified metrics, agent allowlists, row scope, fail-closed org filters, MetricFlow warmup, industry packs, org-specific thresholds, and file logging. The authoritative graph in `existing onto/core.yaml` is **not** loaded at runtime; agents use a parallel but aligned `wt:*` module system. **Security is honor-system** (body org id). **Spoke integration is waiting** on product teams. **Next:** P0 warehouse verify + org2000 template + integration doc — then P1 polish.

---

## 10. How to continue in a new chat

```
@Files docs/CHAT_EXPORT_SUMMARY.md
@Files docs/HANDOFF_CHAT_CONTEXT.md
@Files docs/ROADMAP_ENHANCEMENTS.md

Continue from P0.1: run ticketing dbt run and verify open ticket + SLA metrics on org1000.
```

Or pick any item from Section 6 and say: *"Implement P1.5 — MF reload endpoint"*.
