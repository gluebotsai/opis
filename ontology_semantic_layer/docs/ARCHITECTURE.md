# Repository architecture

Three buckets: **ontology** (meaning), **semantic** (metrics/warehouse), **docs** (shared guides + archive).

---

## Top level

```text
ontology_semantic_layer/
├── README.md
├── TRACEBACK.md
├── requirements.txt
│
├── ontology/                 # MEANING — types, agents, slices, policies
├── semantic/                 # METRICS — registry, query, dbt, data plane
├── docs/                     # SHARED — guides spanning both + archive
├── api/                      # FastAPI service
├── tenants/                  # Per-org overlays
├── scripts/                  # Automation + test runners
├── tests/fixtures/           # Integration test JSON
└── profiles/                 # dbt profiles (gitignored)
```

---

## `ontology/` — meaning layer

| Path | Runtime? | Purpose |
|------|----------|---------|
| `agents.yml` | Yes | Registered agents → preset / modules |
| `catalog.yml` | Yes | Presets, module registry, allowlists |
| `modules/` | Yes | Types, actions, metric id lists |
| `metric_policies.yml` | Yes | Dims, scope, when/not_for |
| `metric_capabilities.yml` | Yes | SKU, channel, role gates |
| `taxonomy.yml` | Yes | Classification term trees |
| `industry/` | Yes | Vertical label packs |
| `slice.py` | Yes | Slice compiler |
| `slices/` | No | Compiled preset dumps (`regen_slices.py`) |
| **`AGENT_INVENTORY.yml`** | No | Master agent inventory from product docs |
| `reference/` | No | Source agent catalogs + ontology design archive |

See [ONTOLOGY.md](ONTOLOGY.md).

---

## `semantic/` — metrics + warehouse

| Path | Runtime? | Purpose |
|------|----------|---------|
| `context.py`, `query.py`, `entitlements.py`, … | Yes | Query gateway + control plane |
| `metric_registry.yml` | Yes | Certified metric ids (generated) |
| `metric_thresholds.yml` | Yes | Platform thresholds (generated) |
| `catalog/` | Yes | SQL-agent catalog (generated) |
| `metricflow/` | Yes | Manifest resolver + engine |
| `dbt/postgres/` | Yes | Warehouse SQL (staging + marts) |
| `dbt/{ccaas,crm,...}/` | Yes | Per-domain MetricFlow YAML only |
| `dbt/webtracking/` | Yes | ClickHouse project |
| **`PRODUCT_DATA_PLANE.yml`** | No | Schema map, accounts/cdp tables, nesting rules |
| `reference/` | — | Pointer to data-plane notes |

See [SEMANTIC_LAYER.md](SEMANTIC_LAYER.md).

---

## `docs/` — shared (not ontology or semantic code)

| Path | Purpose |
|------|---------|
| `ONTOLOGY.md` | Guide to the ontology folder |
| `SEMANTIC_LAYER.md` | Guide to the semantic folder |
| `ARCHITECTURE.md` | This file |
| `WORKFLOW.md` | Commands, tests, troubleshooting |
| `SEMANTIC_LAYER_OPERATIONS_WORKFLOW.md` | Ops runbook |
| `ENTERPRISE_CONTEXT_LAYER.md` | Platform principles (ontology + semantic) |
| `ONTOLOGY_AND_SEMANTIC_LAYER.md` | Combined early design doc |
| `HUB_FOR_SPOKES.md` | Hub ↔ spoke integration |
| `ROADMAP_ENHANCEMENTS.md` | Roadmap |
| `archive/` | Chat exports, evaluation reports |

---

## `semantic/dbt/` — warehouse mesh

```text
semantic/dbt/
├── postgres/          # ALL Postgres staging + marts SQL
├── ccaas/ crm/ campaign/ ticketing/   # semantic_layer YAML only
└── webtracking/       # ClickHouse (full project)
```

---

## `tenants/` — org overlays

`tenants/org{id}/semantic.yaml` — labels, synonyms, thresholds. SKUs → accounts DB.

---

## `tests/fixtures/ccaas/`

`ccaas_mf_payloads.json`, `ccaas_test_results.json` — integration matrix (not runtime).

---

## Further reading

- [ONTOLOGY.md](ONTOLOGY.md)
- [SEMANTIC_LAYER.md](SEMANTIC_LAYER.md)
- [WORKFLOW.md](WORKFLOW.md)
