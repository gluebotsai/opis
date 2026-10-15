# Worktual Ontology & Semantic Layer

Deterministic **ontology slices** and **certified metrics** for multi-spoke MAS agents (Contact Centre, Ticketing, CRM, Campaign, Hub, CDP, Web Tracking).

Each agent gets only the types, actions, and metric **ids** it may use — not the full graph, not SQL, not live customer rows. KPI **values** come from a separate semantic query path with entitlements and row scope enforced.

---

## Start here

| Document | What it covers |
|----------|----------------|
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | **Folder map** — what lives where (start here after cleanup) |
| **[docs/ONTOLOGY.md](docs/ONTOLOGY.md)** | **Why** ontology exists, how slices are built, spoke vs Hub |
| **[docs/SEMANTIC_LAYER.md](docs/SEMANTIC_LAYER.md)** | **Why** semantic layer exists, warehouse mesh, query path |
| [docs/SEMANTIC_LAYER_OPERATIONS_WORKFLOW.md](docs/SEMANTIC_LAYER_OPERATIONS_WORKFLOW.md) | Day-to-day ops — add org, metric, agent |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | Commands, tests, troubleshooting |
| [ontology/reference/](ontology/reference/) | Agent catalog source docs |
| [docs/archive/](docs/archive/) | Historical chat exports and evaluations |
| [TRACEBACK.md](TRACEBACK.md) | Full build history |

---

## Two planes (do not mix them)

```text
ONTOLOGY (meaning)          SEMANTIC (numbers)
──────────────────          ──────────────────
wt:Customer, wt:Ticket      total_conversations, sla_breach_rate
actions, taxonomy terms     MetricFlow formulas + mart SQL
POST /v1/ontology/slice     POST /v1/semantic/query
prompt + metrics[]          rows + interpretation
```

**Motive in one line:** Ontology tells the agent *what it may talk about*; semantic layer tells the system *how to compute and gate KPIs* for this org, user, and SKU.

---

## Repository layout

```text
api/                         # FastAPI service
ontology/                    # Types, modules, agents, policies
semantic/                    # Query gateway, registry, dbt mesh
tenants/org{id}/             # Per-org labels and thresholds
scripts/                     # dbt, tests, generators
docs/                        # All documentation (see ARCHITECTURE.md)
profiles/                    # dbt profiles (auto-generated, gitignored)
```

Full map: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

### `semantic/dbt/` — why multiple folders?

This is intentional after the **Postgres warehouse mesh** migration:

| Path | Contents | Role |
|------|----------|------|
| **`postgres/default/dbt/`** | All Postgres **staging + marts** SQL | One warehouse; `dbt_run_all.py` runs here |
| **`ccaas/`, `crm/`, `campaign/`, `ticketing/`** | **`semantic_layer/` YAML only** | One MetricFlow manifest per domain (no duplicate SQL) |
| **`webtracking/`** | Full ClickHouse project | Separate engine |

Domain semantic packages depend on the postgres warehouse via `packages.yml`. **Do not delete `campaign` or `crm` folders** — they hold MetricFlow definitions, not warehouse duplicates.

Details: [docs/SEMANTIC_LAYER.md](docs/SEMANTIC_LAYER.md).

---

## For spoke engineers

### Endpoints

| Endpoint | Use |
|----------|-----|
| `POST /v1/ontology/slice` | Agent context — types, actions, metric ids (`prompt`) |
| `POST /v1/ontology/hub` | Hub — union of entitled spokes |
| `POST /v1/semantic/query` | KPI values — MetricFlow execution |
| `GET /health` | Liveness + MetricFlow warmup status |

### Slice request (recommended)

```json
{
  "organizationId": 1000,
  "userId": 42,
  "agent": "cc.reporting",
  "product": "ccaas"
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `organizationId` | Yes | DB org id → tenant `org{id}` |
| `userId` | Recommended | Packs `metrics[]` by entitlements + role; clips channel taxonomy |
| `product` | Spokes | Origin SKU: `ccaas`, `crm`, `ticketing`, `campaign`, `cdp`, `webtracking` |
| `agent` | One of three | From [`ontology/agents.yml`](ontology/agents.yml) — preferred |
| `preset` / `modules` | One of three | Alternative selectors — see [docs/ONTOLOGY.md](docs/ONTOLOGY.md) |

### Hub request

```json
{
  "organizationId": 1008,
  "agent": "hub.orchestrator",
  "products": ["contact_centre", "crm"]
}
```

`products[]` is **intersected** with accounts entitlements — the body cannot grant unpaid SKUs.

### Default response

```json
{
  "organizationId": 1000,
  "tenant": "org1000",
  "prompt": "Ontology (this agent — use only these types and actions)\n...",
  "metrics": [{ "id": "total_conversations", "label": "...", "dims": ["channel"], "engine": "postgres" }],
  "entitlements": { "skus": ["contact-center"], "channels": { "ccaas": ["whatsapp", "email"] } },
  "role": "agent"
}
```

Without `userId`, `prompt` still works but `metrics[]` is not packed by role/channel.

### Start the service

```bash
pip install -r requirements.txt
./scripts/run_context_layer_api.sh   # port 8765
curl -s http://localhost:8765/health
```

### What spokes do NOT call

| Avoid | Why |
|-------|-----|
| MetricFlow / dbt directly | Use `POST /v1/semantic/query` |
| `format=json` on hot path | Full slice dump — admin only |
| Trusting Hub `products[]` alone | Server intersects with accounts DB |

Live customer rows → **CDP / spoke APIs**. KPI numbers → **semantic query**.

---

## Quick start (developers)

```bash
pip install -r requirements.txt
./scripts/run_context_layer_api.sh
```

```python
from ontology.slice import fetch_ontology_slice

pack = fetch_ontology_slice(
    agent="crm.deals",
    tenant="org1000",
    product="crm",
    user_id=42,
    organization_id=1000,
)
print(pack.as_prompt())
```

### Tests

```bash
PYTHONPATH=. python3 scripts/test_context_resolver.py      # entitlements + role
PYTHONPATH=. python3 scripts/test_query_engine_routing.py  # engine + channel inject
PYTHONPATH=. python3 scripts/test_spoke_context_layer.py   # live API (API must be up)
```

### dbt (warehouse + semantic parse)

```bash
PYTHONPATH=. python3 scripts/dbt_parse_all.py    # postgres + semantic packages
PYTHONPATH=. python3 scripts/dbt_run_all.py      # warehouse mesh only
PYTHONPATH=. python3 scripts/generate_metric_registry.py
```

---

## Maintenance

| Change | Where |
|--------|-------|
| New agent | [`ontology/agents.yml`](ontology/agents.yml) + preset in [`ontology/catalog.yml`](ontology/catalog.yml) |
| New type / action | [`ontology/modules/`](ontology/modules/) |
| New KPI formula | dbt `semantic_layer.yml` → `generate_metric_registry.py` → policies + catalog |
| Tenant labels / thresholds | `tenants/org{id}/semantic.yaml` |
| Purchased SKUs / channels | Accounts DB (not tenant YAML) |
| Capability gates (channel, role) | [`ontology/metric_capabilities.yml`](ontology/metric_capabilities.yml) |

---

## Further reading

- [docs/ENTERPRISE_CONTEXT_LAYER.md](docs/ENTERPRISE_CONTEXT_LAYER.md) — platform principles
- [ontology/AGENT_INVENTORY.yml](ontology/AGENT_INVENTORY.yml) — full agent inventory
- [semantic/PRODUCT_DATA_PLANE.yml](semantic/PRODUCT_DATA_PLANE.yml) — warehouse schema map
- [api/README.md](api/README.md) — HTTP reference
- [tenants/org1000/FETCH_EXAMPLES.md](tenants/org1000/FETCH_EXAMPLES.md) — fetch examples
