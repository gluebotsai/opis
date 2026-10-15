# Ticketing MAS ↔ Context Layer oracle contract

Use this when comparing `/v1/semantic/query` to warehouse “truth.”

## Baseline SQL

For every certified metric id in [`ontology/modules/metrics_ticketing.yml`](../ontology/modules/metrics_ticketing.yml):

1. Load SQL from [`semantic/sql/metric_templates/ticketing.yml`](../semantic/sql/metric_templates/ticketing.yml) (same formulas as MetricFlow).
2. Bind `organization_id` + the same `time.start` / `time.end` the API received.
3. Apply the same RBAC/`dataScope` as the API request.
4. Compare floats with a small relative epsilon (~1e-6, or 0.001 absolute for ratios).

**Do not** hand-write alternate mart SQL that redefines active/closed/breach.

## Forbidden proxies (caused Sep 20 false MISMATCH)

| Metric under test | Forbidden DB baseline |
|---|---|
| `average_open_ticket_age_days` | open/pending **ticket count** |
| `average_overdue_hours` | overdue **ticket count** |
| `csat_score_total` | `average_csat_score` |
| `accounts_served` | ticket volume / assigned count |
| `approval_volume` / `audit_event_volume` / `customer_reply_volume` | ticket volume |
| `average_resolution_hours_variance` | mean resolution hours |

## Time windows

- Prefer date-only `time.start` / `time.end` (`YYYY-MM-DD`).
- Accepted periods: `today`, `last_7d` / `last_7_days`, `last_30d` / `last_30_days`, `all_time` / `overall`.
- If `last_7d == all_time` on event metrics, check whether **all source rows fall inside 7 days** before filing a CL bug.

## group_by comparison

1. API must return **all buckets** (including false/null for booleans).
2. For **count** metrics: `sum(bucket values) == ungrouped scalar` (same filters/time).
3. For **averages/rates**: compare per-key maps (or certified re-aggregate); do **not** require sum==scalar.
4. Never compare the first/max bucket alone to the ungrouped total.

## UNMAPPED

Any id in `metrics_ticketing.yml` with a template is **mapped**. If the harness has no baseline SQL, that is a harness gap — not a CL gap. Use `scripts/audit_ticketing_semantic_matrix.py`.

## Definitions (locked)

| Metric | Definition |
|---|---|
| `active_tickets_metric` | `is_pending` (non-closed) |
| `open_tickets_metric` | `is_open` (`status = Open`) |
| `closed_tickets_metric` | `is_closed` (terminal OR resolved) |
| `breached_tickets_metric` | `is_breached_proxy` (not `is_overdue`) |
| `accounts_served` | `COUNT(DISTINCT account_id)` (0 is valid when org has no accounts) |
| `csat_score_total` | `SUM(csat_score)` |
| `average_tickets_per_day` | ticket count ÷ distinct `created_at::date` in window |

## MCP / tools

Expose both `ask_semantic` (or `ask_semantic_layer`) and `ask_sql_layer` / SQL query tool in the ticketing agent tool catalog so clients can discover certified KPI vs row SQL paths. List queries for customers/teams/statuses need warehouse `entityHint` (see [TICKETING_CONTEXT_LAYER_INTEGRATION.md](../docs/TICKETING_CONTEXT_LAYER_INTEGRATION.md)).

## Reproduce

```bash
ORG=1012 USER_ID=1028 MATRIX_MODE=core PYTHONPATH=. \
  python3 scripts/audit_ticketing_semantic_matrix.py
```
