# Ticketing SQL agent

How the isolated SQL Super path is built for ticketing, how certified KPI templates work, how each query type is routed, and how SQL is parameterized (no string-concatenated values).

**Endpoint:** `POST /v1/sql/query`  
**Package:** `sql_agent/` (not MetricFlow). Counts and lists run on operational Postgres (`ticketing.tickets`, notes, queues, …). Certified KPIs use **pre-written** SQL in `sql_agent/kpi_templates/ticketing.yml`.  
**Related:** [SQL_AGENT.md](./SQL_AGENT.md) (all products), [TICKETING_CONTEXT_LAYER_INTEGRATION.md](./TICKETING_CONTEXT_LAYER_INTEGRATION.md) (identity / `dataScope`).

---

## Why this stack exists

Chat agents must not invent SQL. They send a natural-language `instruction` plus org/user/product/agent. The SQL agent:

1. Plans a **structured job** (intent, table, columns, filters, time window, metric id) — Gemma returns JSON only, never SQL.
2. **Validates** that job against a compiled catalog and agent policy.
3. **Compiles** a read-only `SELECT` with `%s` placeholders.
4. **Binds** org id, user ids, dates, and filter values with `psycopg2`.

That split is how the path was created: LLM for *shape*, Python for *SQL*.

```text
Spoke agent (analytics / lifecycle / …)
        │  instruction, organizationId, userId, originProduct=ticketing, originAgent
        ▼
POST /v1/sql/query                          api/main.py
        │
        ▼
execute_sql_query()                         sql_agent/super.py
        ├── plan_sql_query()                Gemma Super  → SqlPlan
        └── execute_plan()                  sql_agent/mas/orchestrator.py
              ├── build_constrained_job()   Gemma executor (optional)
              ├── validate_constrained_job()
              ├── constrained_to_executor_job()   harness: scope, time fold, filters
              └── _dispatch() → executors/ticketing.py
                    ├── list / count / group  → ticketing_sql/builder.py
                    └── kpi                   → metric_fallback.py + kpi_templates/ticketing.yml
                          └── db.run_postgres_query(sql, params)
```

Gemma HTTP: `sql_agent/mas/gemma_client.py` (`chat_json`). System prompts:

| Role | File | Constant |
|------|------|----------|
| Super planner | `sql_agent/mas/super_planner.py` | `_SUPER_SYSTEM` |
| Product executor | `sql_agent/mas/product_executor.py` | `_EXECUTOR_SYSTEM` |

User payload for Super is JSON (instruction, preset catalog, formula cards). Executor payload is JSON (instruction, intent, catalog slice with `default_select` and column allowlists).

---

## Building blocks (what was created)

| Piece | Path | Role |
|-------|------|------|
| Request | `sql_agent/job.py` `SqlQueryRequest` | Instruction + origin, no SQL |
| Plan | `sql_agent/mas/plan_schema.py` `SqlPlan` | `intent`, `preset_id`, filters, time, optional `metric_id` |
| Constrained job | same file `ConstrainedJob` | Table/select/filters from catalog only |
| Executor job | `sql_agent/job.py` `ExecutorJob` | What actually compiles to SQL |
| Presets | `sql_agent/presets/catalog.yml` | Ticketing slices: `tk.tickets`, `tk.queue`, `tk.notes`, `tk.audit`, `tk.contacts`, `tk.accounts`, `tk.statuses`, `tk.kb`, `tk.macros` |
| Catalog | See [Compiled catalog](#compiled-catalog-not-the-full-database) | In-memory allowlist of tables/columns — not `information_schema` per request |
| Intent gate | `sql_agent/mas/intent_gate.py` | Deterministic hint: list vs count vs created-by, calendar bounds |
| Time | `sql_agent/time_window.py` | `last 7 days` → `time_start`/`time_end`; folds illegal `created_at >=` filters off `filters[]` |
| Scope | `sql_agent/ticketing_scope.py` | `org` / `assignee` / `team` / `created_by`; `userId` is `ticketing.agents.id` |
| Policy | `sql_agent/agent_policy.py`, `ontology/agent_metrics.yml` | Which agents may run KPIs vs list-only |
| Filters | `sql_agent/sql_filters.py` | `eq` / `in` / `ilike` / `not_in` only on `filters[]` |
| Validator | `sql_agent/validator.py` | Read-only SQL (no INSERT/UPDATE/…) |

`semantic/sql/` re-exports this package. New work should import `sql_agent`.

---

## Compiled catalog (not the full database)

The SQL agent never “searches the database” for schema on a user question. Postgres is used only to **run the final SELECT**. What tables and columns exist is a **YAML snapshot** loaded into process memory.

That is the efficiency: one compile (or a checked-in operational file) instead of `information_schema` / `pg_catalog` on every `/v1/sql/query`, and the LLM never sees the whole warehouse.

### How the compiled snapshot is built

`scripts/compile_sql_catalog.py` is a **build-time** job (after dbt/mart or ops schema changes), not part of the request path.

1. **YAML allowlist first** — `sql_agent/catalog/sources/ticketing.yaml` (marts/staging) names the tables the agent is allowed to know. Tables marked `sql_agent_only: true` are skipped.
2. **Live introspection, scoped** — one query against `information_schema.columns` (and PK/FK) **only** for product schemas, not the whole cluster:

   `ticketing_marts`, `ticketing_staging`, `ticketing`, `accounts`, `cdp`

3. **Merge** — for each YAML table, columns = YAML names ∪ warehouse columns ∪ semantic dimensions. PK/FK from Postgres are attached when present.
4. **Joins** — copy the hand-written allowlist from `sql_agent/catalog/sources/joins.yml` (ticket → contact_profile, notes → tickets, …). Gemma cannot invent a join pair.
5. **Write** — `sql_agent/catalog/compiled/ticketing.yml` (checked in; regenerate with `python3 scripts/compile_sql_catalog.py --product ticketing`).

If Postgres is unreachable at compile time, column lists stay YAML-only.

### What ticketing loads at runtime

`sql_agent/compiled_catalog.py` `load_compiled_catalog("ticketing")`:

1. Prefer **`sql_agent/catalog/sources/ticketing_operational.yaml`** — small ops surface (`tickets`, `agents`, `agent_queues`, notes, …) matching list/KPI SQL on `ticketing.*`.
2. Else **`sql_agent/catalog/compiled/ticketing.yml`**.
3. Else derive a slice from sources YAML.

`get_table()` / `allowed_columns()` (`sql_agent/catalog_loader.py`) read that dict. Unknown table/column → 400, not a warehouse `DESCRIBE`.

API startup (`semantic/runtime_warm.py`) calls `warm_compiled_catalogs()` so the YAML is parsed **once** into `_cache`. Later requests are dict lookups.

### Why this is cheaper than exploring the database

| Approach | Cost per user query |
|----------|---------------------|
| Introspect Postgres (`information_schema`, `\d`, search_path) | Extra round-trips + huge schema in the prompt |
| Dump all schemas to Gemma | Tokens, latency, hallucinated tables |
| **Compiled / operational catalog** | YAML already in RAM; O(tables in preset) |

Further shrinking for the LLM:

| Slice | Function | What Gemma sees |
|-------|----------|-----------------|
| Super | `list_preset_summaries` | Preset id + one-line purpose (`tk.tickets`, …) — not every column |
| Executor | `preset_executor_slice` | **Only tables on that preset** (e.g. `tk.tickets` → `tickets` + columns, PK, FK, `row_scope_column`) |
| Planner compact | `planner_slice` | Cap: 12 tables, 20 columns each (other products) |

Harness then fails closed: `select` / `filters` / `group_by` / joins must be in that allowlist. The warehouse query is a single parameterized `SELECT` on one (or join-allowlisted) table — no catalog crawl.

**Ops:** after adding a column or table, update sources YAML (and operational YAML for ticketing list), run `compile_sql_catalog.py`, restart the API so `_cache` reloads. Stale catalog vs live DB → `missing_warehouse_table` / `missing_warehouse_column`, not a silent full-DB search.

---

## Query types

Single enum: `list | count_scalar | count_grouped | kpi` (`sql_agent/mas/intent_kinds.py`).

Harness order in `constrained_to_executor_job` (`sql_agent/mas/harness.py`):

1. If `group_by` → **count_grouped**
2. If intent is **list** → strip `metric_id` / `template_id` (lists must not run KPI SQL)
3. If **count_scalar** → `COUNT(*)` with filters + time + scope
4. If **kpi** → certified template only if `metric_validator` matches the instruction
5. Else: scalar-shaped wording (`how many`, `rate`, …) → count_scalar; otherwise list

| Intent | Typical instruction | SQL builder | `_meta.source` |
|--------|---------------------|-------------|----------------|
| `list` | “List tickets created in the last 7 days with dates” | `build_ticketing_list_sql` | `sql_list` |
| `count_scalar` | “How many open tickets?” (no certified match, or list-stripped) | `build_ticketing_count_sql` | `sql_count_scalar` |
| `count_grouped` | “Ticket count by queue / status” | `build_ticketing_group_sql` | `sql_group` |
| `kpi` | “Open ticket count” matching `open_tickets_metric` | `execute_metric_fallback` | `metric_fallback` |

### List

- Table from preset (usually `tickets`).
- `select`: catalog `default_select` plus extras named in the instruction (`list_select_columns` in `sql_agent/presets/loader.py`). Identity columns are not dropped just because the user also asked for dates.
- `WHERE`: tenant `organization_id = %s`, optional channel entitlement, row scope, calendar window, allowlisted filters.
- `ORDER BY` always with `LIMIT` (default `created_at DESC`, limit 20–200).
- Optional CDP live join when the plan sets `cdp_live`.

### Count scalar

Same `WHERE` as list; `SELECT COUNT(*)::bigint AS row_count`. No `LIMIT`. Empty name filters can retry as `ILIKE` (`rewrite_eq_filters_to_ilike`).

### Count grouped

`GROUP BY` allowlisted columns (status, queue_name, …). Time grains may `date_trunc` on `created_at` / `updated_at` / `resolved_at` / `due_at`. Result column `ticket_count`.

### KPI (certified template)

Gemma may set `metric_id` only when a **formula card** matches. `sql_agent/mas/metric_validator.py` owns declared filters (e.g. `open_tickets_metric` encodes `status=open`). Mismatch → reject metric, fall back to count_scalar with explicit filters.

Lifecycle / list-only agents cannot force KPI (`orchestrator.py` + `agent_policy.py`).

---

## KPI SQL templates

**File:** `sql_agent/kpi_templates/ticketing.yml`  
**Loader:** `sql_agent/kpi_template_registry.py` (`get_template(product, metric_id)`)  
**Runner:** `sql_agent/metric_fallback.py`

There are **97** certified ticketing metric ids (counts, rates, averages, CSAT, SLA, notes, KB, recommendations, …). Each entry looks like:

```yaml
open_tickets_metric:
  product: ticketing
  result_column: open_tickets_metric
  time_column: created_at
  table: tickets
  default_zero: true
  sql: |
    WITH enriched AS ( … joins tickets + statuses + SLA + assignee … )
    SELECT COUNT(ticket_id)::bigint AS open_tickets_metric
    FROM enriched
    WHERE organization_id = %s{{extra_where}}
  enriched_base: tickets
```

### What the template owns vs what Python injects

| In the YAML | Meaning |
|-------------|---------|
| `sql` | Frozen formula. LLM never writes this. |
| `organization_id = %s` | First bind: tenant. |
| `{{extra_where}}` | Placeholder replaced at runtime (leading ` AND …` or empty). |
| `result_column` | Column name returned to the client. |
| `time_column` | Which timestamp `time_start`/`time_end` apply to (`created_at`, sometimes `resolved_at`). |
| `table` / `row_scope_column` | Catalog + assignee column for personal KPIs. |
| `enriched_base: tickets` | If SQL is not already a `WITH`, wrap via `sql_agent/ticketing_sql/enriched.py` so flags like `is_open`, `is_overdue` exist without dbt marts. |
| `default_zero` | Empty result → `{metric: 0}`. |

`{{extra_where}}` is filled by `_build_extra_where`:

- Channel `IN (%s, …)` when entitled
- Row scope: `assignee_id` / `created_by_id` / team `queue_id` (`ticketing_row_scope_clause`)
- Time: `col >= %s::date AND col < (%s::date + interval '1 day')`
- Extra `filters[]` as parameterized `eq`/`in`/`ilike`

Window alias metrics (`tickets_last_7_days`, `tickets_created_today_metric`) get bounds from `bounds_for_metric_alias` if the job has no time yet.

Certification = “template exists”, not MetricFlow. `sql_agent/kpi_certified.py` `is_certified()`. Ontology policies (`ontology/metric_policies.yml`) still define *when* a metric is allowed and its scope (`org`, `assignee_or_team`, `created_by`).

Planner sees a short list of high-traffic cards in `sql_agent/mas/formula_cards.py` (open, volume, created-by-me, SLA, …) — not the full 97 — so Gemma does not pick a filter-encoding metric for a generic “how many tickets”.

---

## Parameterized SQL (how values are bound)

The warehouse never receives user text spliced into SQL.

1. **Identifiers** (schema, table, column) go through `quote_ident()` after catalog allowlist.
2. **Literals** are `%s` + a Python `params` list.
3. **`cur.execute(sql, params)`** in `sql_agent/db.py` `run_postgres_query` (shared Postgres pool).
4. **`validate_readonly_sql(sql)`** runs before execute (forbidden INSERT/UPDATE/COPY/…).

### List / count / group (`ticketing_sql/builder.py`)

Typical bind order:

1. `organization_id`
2. Entitled channels (optional)
3. Scope ids (`assignee_id IN (%s)`, `created_by_id IN (%s)`, or `queue_id IN (%s)` + person)
4. Time start / end (ISO date `YYYY-MM-DD`)
5. Each filter value (`status`, `priority`, `queue_name`, …)

Filter ops on `filters[]`: `eq`, `neq`, `in`, `not_in`, `contains`/`ilike`/`like`. **Not** `>=`. Calendar windows must sit on `ExecutorJob.time_start` / `time_end`. If Gemma still emits `{column: created_at, op: ">="}`, `fold_time_filters` removes it and keeps the instruction-owned window.

Status/priority comparisons use `lower(col::text) = %s` with lowercased binds.

### KPI templates

Template SQL already contains `WHERE organization_id = %s{{extra_where}}`. After substitution:

```text
params = [organization_id] + extra_where_params
```

If the template repeats `organization_id = %s` (rare nested subquery), the same slot list is repeated (`sql.count("organization_id = %s")`).

### What is *not* parameterized

- The **shape** of certified KPI SQL (joins, `COUNT(*) FILTER (WHERE is_open)`).
- `date_trunc('day', …)` grain (allowlisted enum, not user SQL).
- `LIMIT n` is an int interpolated after `int(job.limit)` (bounded 1–200), not a user string.

---

## Ticketing-specific behavior

**Identity.** `userId` on the request is `ticketing.agents.id` for org `organizationId` (`sql_agent/user_scope.py`). Not `accounts.setup_users.id`.

**Row scope**

| Mode | Predicate |
|------|-----------|
| `org` | No person filter (admin default) |
| `assignee` | `assignee_id IN (user)`; resolvers also `OR resolver_id` |
| `created_by` | `created_by_id IN (user)` — metric `tickets_created_by_me` or “created by me” list |
| `team` | `queue_id IN (my queues)` or person clause; empty queues → `FALSE` |

`dataScope=mine` on **semantic** query means assignee, not creator. SQL MAS uses instruction + `scope_mode`.

**Instruction-first calendar.** “last 7 days” / “today” / “last 30 days” → `bounds_from_instruction` in the harness, overwriting Gemma dates when the instruction names a window.

**ILIKE retry.** Empty list/count on name-like columns retries equality as `ILIKE %token%`.

---

## Request and response shape

```json
{
  "organizationId": 1012,
  "userId": 1028,
  "originProduct": "ticketing",
  "originAgent": "analytics_audit_query_executor",
  "instruction": "List tickets created in the last 7 days along with the dates"
}
```

Success rows plus `_meta.source` (`sql_list` | `sql_count_scalar` | `sql_group` | `metric_fallback`), `presetId`, `planner` (`gemma`), `table`, `scope`.

Typed failures: `SqlAgentError` / `SqlValidationError` → HTTP 400 (`validation_error`, `needs_clarification`, `kpi_not_allowed`, …). Warehouse down → 503.

---

## File map (ticketing)

```text
api/main.py                          POST /v1/sql/query
sql_agent/super.py                   execute_sql_query
sql_agent/mas/gemma_client.py        LLM HTTP
sql_agent/mas/super_planner.py       plan JSON
sql_agent/mas/product_executor.py    job JSON
sql_agent/mas/orchestrator.py        plan → execute
sql_agent/mas/harness.py             catalog, scope, time fold, ExecutorJob
sql_agent/mas/intent_gate.py         list/count/created-by/time hint
sql_agent/mas/metric_validator.py    KPI vs instruction filters
sql_agent/executors/ticketing.py     dispatch list/count/group/kpi
sql_agent/ticketing_sql/builder.py   parameterized list/count/group SQL
sql_agent/ticketing_sql/enriched.py  shared ticket CTE for templates
sql_agent/metric_fallback.py         {{extra_where}} + template execute
sql_agent/kpi_templates/ticketing.yml  97 certified KPI SQLs
sql_agent/presets/catalog.yml        tk.* list presets
sql_agent/catalog/sources/ticketing.yaml
sql_agent/catalog/sources/ticketing_operational.yaml
sql_agent/catalog/sources/joins.yml
sql_agent/catalog/compiled/ticketing.yml
scripts/compile_sql_catalog.py       build-time information_schema merge
sql_agent/compiled_catalog.py        load + in-memory cache
sql_agent/catalog_loader.py          get_table / allowed_columns
sql_agent/sql_filters.py             filter ops
sql_agent/time_window.py             calendar + fold >= off filters
sql_agent/ticketing_scope.py         org/assignee/team/created_by
sql_agent/db.py                      execute(sql, params)
```
