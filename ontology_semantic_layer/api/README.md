# Context Layer API (v1.2.0)

HTTP service on port **8765** with three public endpoints:

| Endpoint | Caller | Purpose |
|----------|--------|---------|
| `POST /v1/ontology/slice` | Spokes | Compact ontology policy for one agent/preset/modules + `product` |
| `POST /v1/ontology/hub` | Hub MAS | Product map from entitled `products[]` (no agent selector) |
| `POST /v1/semantic/query` | Any agent | Structured MetricFlow execute (certify + allowlist + row scope) |

## Start

```bash
cd /path/to/ontology_semantic_layer
pip install -r requirements.txt
./scripts/run_context_layer_api.sh
```

Verify:

```bash
curl -s http://localhost:8765/health
curl -s http://localhost:8765/
```

Logs (on startup): `logs/context_layer.log` (INFO+) and `logs/error.log` (ERROR+ only).

Org metric thresholds: `tenants/org{id}/org{id}_metrics.yaml` (formulas stay in MetricFlow).

## Spoke — `POST /v1/ontology/slice`

```json
{
  "organizationId": 1000,
  "agent": "crm.deals",
  "product": "crm"
}
```

Exactly **one** of `agent`, `preset`, or `modules`. Required `product` (string). Hub is **rejected** here — use `/v1/ontology/hub`.

## Hub — `POST /v1/ontology/hub`

```json
{
  "organizationId": 1008,
  "products": ["contact_centre", "crm"]
}
```

No `agent`, `preset`, `modules`, or `product`. Exact SKU list; aliases like `ccaas` → `contact_centre`.

## Semantic — `POST /v1/semantic/query`

```json
{
  "organizationId": 1000,
  "userId": 42,
  "product": "crm",
  "agent": "crm.deals",
  "metrics": ["won_deal_rate"],
  "group_by": ["stage"],
  "filters": [{ "dimension": "stage", "op": "in", "values": ["negotiation"] }],
  "time": { "start": "2026-08-01", "end": "2026-09-01", "grain": "day" },
  "limit": 50
}
```

Gateway: certify metric → agent allowlist → dimension policy → `accounts.setup_users` row scope → MetricFlow.

Returns **503** with a `validated` payload when manifests or MetricFlow are unavailable (validation still runs).

## Compile dbt / MetricFlow manifests (all products)

One command — `dbt deps` + `dbt parse` for shared, campaign, crm, ccaas, ticketing:

```bash
pip install -r requirements-dbt.txt
PYTHONPATH=. python3 scripts/dbt_parse_all.py
```

Reads Postgres credentials from `.env` and writes `profiles/profiles.yml`.  
Webtracking is skipped unless `ch_host` is set (ClickHouse).

After `dbt parse` / `dbt run` or edits to cached YAML (`catalog.yml`, `agents.yml`, `metric_policies.yml`, …), reload in-memory state **without** restarting the process:

```bash
export CONTEXT_RELOAD_SECRET=your-secret   # required; endpoint 404 if unset
./scripts/reload_context_layer.sh
```

`POST /v1/admin/reload` with header `X-Reload-Secret`. Clears ontology catalog, policies, thresholds, MetricFlow engines; re-warms when `MF_WARM=1`.

The start script does **not** use uvicorn `--reload` — saving files does not restart the API.

All endpoints (including admin) are listed at **http://localhost:8765/docs**.

## Tests

```bash
PYTHONPATH=. python3 scripts/test_spoke_context_layer.py
PYTHONPATH=. python3 scripts/test_runtime_reload.py
```
