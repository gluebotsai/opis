# Ontology — purpose and how it works

This document explains **why** the ontology layer exists and **how** agents get a safe, deterministic slice of product meaning at runtime.

For API copy-paste examples see [README](../README.md). For metric SQL and warehouse layout see [SEMANTIC_LAYER.md](SEMANTIC_LAYER.md).

---

## Motive

Worktual is a **multi-spoke** platform: Contact Centre, Ticketing, CRM, Campaign, Hub, CDP, Web Tracking. Each spoke has its own agents, tools, and data — but customers expect one coherent product language.

**The problem we solve**

| Without ontology | With ontology |
|------------------|---------------|
| Every agent prompt embeds ad-hoc type lists | One certified vocabulary (`wt:Customer`, `wt:Ticket`, …) |
| LLM invents metrics and dimensions | Agent sees only **certified metric ids**; formulas stay in MetricFlow |
| Tenant says “Prospect” vs “Patient” forks the graph | Same type id, **tenant label overlay** |
| Hub merges CCaaS + CRM blindly | Hub gets **union of entitled spokes**, deduped shared types |
| Upsell Instagram channel requires new YAML per tenant | **Accounts entitlements** pack metrics per request |

**Core principle:** Ontology answers *“what exists and what may I do?”* It does **not** hold SQL, live customer rows, or KPI formulas.

---

## What ontology owns vs what it does not

| Ontology owns | Ontology does **not** own |
|---------------|---------------------------|
| Classes (`wt:Customer`, `wt:Ticket`, `wt:Deal`) | Warehouse tables / mart SQL |
| Relations (`Customer has Ticket`) | MetricFlow measure definitions |
| Actions (`create_ticket`, `assign_queue`) | Live CDP profile rows |
| Taxonomy term ids (`channel:whatsapp`, `priority:p1`) | MCP tool JSON schemas (resolved at runtime) |
| **Metric ids** agents may mention (`sla_breach_rate`) | The numeric result of a metric |
| Module packs and agent presets | Purchased SKUs (accounts DB) |

**Semantic layer** (separate doc) owns formulas, dimensions, and query execution. **CDP / spoke APIs** own instance facts.

### CDP module (customer spine)

CDP is a **foundation module**, not a spoke warehouse. [`ontology/modules/cdp.yml`](../ontology/modules/cdp.yml) defines `wt:Customer`, identity keys, and events. [`ontology/modules/metrics_cdp.yml`](../ontology/modules/metrics_cdp.yml) lists **metric ids only** — formulas remain in campaign, CRM, and webtracking MetricFlow packages.

CDP agents (`cdp.profile`) receive metrics through the same control plane as other agents:

- Tenant must have purchased **CDP** (`accounts.active_products`)
- Each metric still requires its **engine SKU** (e.g. `web-tracking` for `web_session_volume`)
- Query execution routes to the correct product manifest via the semantic layer

---

## Architecture at a glance

```mermaid
flowchart TB
  subgraph sources [Git — slow-changing]
    Agents[agents.yml]
    Catalog[catalog.yml]
    Modules[modules/*.yml]
    Policies[metric_policies.yml]
    Tenant[tenants/org{id}/semantic.yaml]
  end

  subgraph control [Control plane — per request]
    Ent[accounts entitlements]
    Cap[metric_capabilities.yml]
    Res[resolve_context]
    Ent --> Res
    Cap --> Res
  end

  subgraph runtime [Context Layer API :8765]
    Slice[POST /v1/ontology/slice]
    Query[POST /v1/semantic/query]
  end

  sources --> Slice
  Res --> Slice
  Res --> Query
  Slice -->|prompt + metrics[]| Agent[Spoke / Hub agent]
  Query -->|rows + interpretation| Agent
```

---

## Three layers of meaning

### 1. Ontology (this document)

Stable product language. Shared across tenants and spokes.

- **Modules** — Lego packs: `identity`, `ticket`, `queue`, `metrics_ccass`, …
- **Catalog presets** — Named bundles: `cc.ai_support`, `crm.deals`, …
- **Agents** — Runtime id → preset or module list (`cc.reporting`, `hub.orchestrator`)

### 2. Taxonomy

Classification trees **on** classes, not new classes.

- Example: `channel` terms → whatsapp, email, instagram
- Clipped per tenant when entitlements limit channels

### 3. Tenant overlay (`tenants/org{id}/`)

Words and thresholds only — not a fork of the graph.

- `labels` — display names (Prospect vs Patient)
- `synonyms` — natural language → `wt:*` ids
- `binds` — where to fetch live rows (CDP URL, mart name)
- `org{id}_metrics.yaml` — threshold overrides

**Purchased SKUs and channels** come from the **accounts database**, not from `enabledSpokes` in YAML (YAML is dev fallback / documentation).

---

## How a slice is built

1. **Request** — `organizationId`, `agent` (or `preset` / `modules`), `product` (spoke) or `products[]` (Hub), optional `userId`.
2. **Resolve agent** — [`ontology/agents.yml`](../ontology/agents.yml) → preset or module list; validate `owned_product` matches `product`.
3. **Expand modules** — Union `depends_on` chains from [`ontology/catalog.yml`](../ontology/catalog.yml).
4. **Legal slice** — All types, relations, actions, and metric ids from selected modules.
5. **Prompt slice** — Preset allowlist filters to compact text for the LLM.
6. **Context packing** (when `userId` + `product` set) — [`semantic/context.py`](../semantic/context.py) intersects metrics with entitlements, channels, features, and role; clips taxonomy channels.
7. **Tenant overlay** — Labels, synonyms, binds from `tenants/org{id}/semantic.yaml`.
8. **Response** — `prompt` string (default) plus structured `metrics[]`, `entitlements`, `role` when context is resolved.

```text
legal_slice = modules ∪ depends_on
prompt_slice = preset.allowlist ∩ legal_slice
visible_metrics = certified ∩ prompt_metrics ∩ SKUs ∩ channels ∩ features ∩ min_role
```

**Slice is UX.** The same resolver runs on [`POST /v1/semantic/query`](../api/main.py) for **enforcement** (reject non-visible metrics, inject channel filters).

---

## Spoke vs Hub

| | Spoke | Hub |
|---|-------|-----|
| Selector | `product` (string) | `products` (non-empty list) |
| Example | `"product": "ccaas"` | `"products": ["contact_centre", "crm"]` |
| Entitlements | Loaded from accounts DB | `products[]` **intersected** with DB — body cannot grant unpaid SKUs |
| Prompt | One spoke chapter | Union of entitled spokes; shared types deduped |

Hub does **not** auto-expand SKUs (CCaaS ≠ ticketing ≠ campaign).

---

## Key files

| Path | Role |
|------|------|
| [`ontology/agents.yml`](../ontology/agents.yml) | Agent id → preset / modules / `owned_product` |
| [`ontology/catalog.yml`](../ontology/catalog.yml) | Presets, module registry, compact allowlists |
| [`ontology/modules/`](../ontology/modules/) | Types, actions, metric id lists per domain |
| [`ontology/metric_policies.yml`](../ontology/metric_policies.yml) | Per-metric dims, scope, when/not_for (agent-facing) |
| [`ontology/metric_capabilities.yml`](../ontology/metric_capabilities.yml) | SKU, channel, feature, role gates |
| [`ontology/taxonomy.yml`](../ontology/taxonomy.yml) | Global term trees |
| [`ontology/slice.py`](../ontology/slice.py) | Slice compiler |
| [`ontology/slices/`](../ontology/slices/) | Optional compiled preset dumps (`regen_slices.py` — not runtime) |
| [`ontology/AGENT_INVENTORY.yml`](../ontology/AGENT_INVENTORY.yml) | Full agent inventory (maps to presets in `catalog.yml`) |
| [`ontology/reference/`](../ontology/reference/) | Source agent catalog MDs + ontology design archive |
| [`tenants/org{id}/`](../tenants/) | Per-org labels, synonyms, thresholds |

---

## Agent integration checklist

1. Call `POST /v1/ontology/slice` with `organizationId`, `agent`, `product`, and **`userId`** when metrics depend on role or channel pack.
2. Inject returned `prompt` into the system context each turn (or cache until deploy / entitlement change).
3. Use metric ids from `metrics[]` (or prompt Metrics section) when calling `POST /v1/semantic/query`.
4. Fetch live customer/ticket rows via CDP or spoke APIs — never from ontology.
5. Do not call MetricFlow or dbt directly from the agent runtime.

---

## Further reading

- [SEMANTIC_LAYER.md](SEMANTIC_LAYER.md) — warehouse mesh, MetricFlow, query path
- [SEMANTIC_LAYER_OPERATIONS_WORKFLOW.md](SEMANTIC_LAYER_OPERATIONS_WORKFLOW.md) — day-to-day ops (add org, metric, agent)
- [WORKFLOW.md](WORKFLOW.md) — commands, tests, control plane summary
- [ENTERPRISE_CONTEXT_LAYER.md](ENTERPRISE_CONTEXT_LAYER.md) — platform principles (shared)
- [TRACEBACK.md](../TRACEBACK.md) — build history
