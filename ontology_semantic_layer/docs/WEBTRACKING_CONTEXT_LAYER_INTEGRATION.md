# Web Tracking ↔ Context Layer integration

**Audience:** Web Tracking / AI_CHAT engineers wiring AnalyticsAgent and InsightsAgent to Worktual Context Layer  
**Service:** Context Layer HTTP API (default `http://<host>:8765`)  
**Product string on every spoke call:** `"webtracking"`  
**Sole ontology source:** `[ontoYMLs/webtracking.yml](../ontoYMLs/webtracking.yml)` — not modules, not `graph_nodes`, not `wt:`*

This document is the **integration contract** for Web Tracking **product** agents: **ontology** (language / product shape) and **semantic** (certified KPI numbers). Use the registered agent ids below. Do not invent new agent names on the wire.

**Guides (product language):**  

- Ontology: `[webtracking_docs/WEB_TRACKING_AGENT_ONTOLOGY.md](../webtracking_docs/WEB_TRACKING_AGENT_ONTOLOGY.md)`  
- Metric / dim requirements: `[webtracking_docs/WEB_TRACKING_AGENT_SEMANTIC_LAYER.md](../webtracking_docs/WEB_TRACKING_AGENT_SEMANTIC_LAYER.md)`  
- ClickHouse schema: `[webtracking_docs/WEB_TRACKING_CLICKHOUSE_FULL_SCHEMA.md](../webtracking_docs/WEB_TRACKING_CLICKHOUSE_FULL_SCHEMA.md)`

**Last updated:** 2026-09-20 — product agents only; Analytics owns ontology + metrics.

---



## 0. What you are building

Web Tracking has **two live product agents**. Context Layer does **not** replace the dashboard chat UI, Insights panel, or ClickHouse ingest. It **does** own certified KPI formulas once you call semantic (same contract as CCaaS / Ticketing).


| Runtime role (product)            | Context Layer agent id  | Who uses it                                                            |
| --------------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| AnalyticsAgent (co-worker chat)   | `webtracking.analytics` | Site owner / marketer in dashboard chat — **ontology + semantic KPIs** |
| InsightsAgent (snapshot narrator) | `webtracking.insights`  | Dashboard Insights panel — **ontology only**                           |


Internal modules inside AnalyticsAgent (query rewrite, known SQL, LLM SQL, answer writing) are **capabilities**, not separate Context Layer agents. Do not call `/v1/ontology/slice` or `/v1/semantic/query` with those names.

You add **two spoke HTTP calls** (Insights needs only the first):


| User need                              | Who calls            | Endpoint                  | What comes back                                                                                                    |
| -------------------------------------- | -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| “What may this agent talk about?”      | Analytics + Insights | `POST /v1/ontology/slice` | `prompt` — data-only YAML for **that** agent’s system prompt; Analytics also gets `metrics[]` when `userId` is set |
| “How many / what rate / what average?” | **Analytics only**   | `POST /v1/semantic/query` | Certified KPI number(s) in `rows` (+ `status` / `threshold` when configured)                                       |


**Split of duties**


| Layer                           | Answers                                                                   | Does **not** answer                    |
| ------------------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| Ontology (`/v1/ontology/slice`) | Visitor ≠ session ≠ page view; bounce meaning; one website only; synonyms | Live counts, rates, SQL                |
| Semantic (`/v1/semantic/query`) | Certified metric values from ClickHouse marts                             | Entity definitions, routing, writes    |
| Your Insights snapshot          | Narrate deltas already computed in the panel                              | Ad-hoc warehouse SQL via Context Layer |


```
User question (chat)
  → AnalyticsAgent
       ├─ system prompt = slice.prompt from webtracking.analytics
       ├─ resolve entities / follow-ups using ontology
       └─ how-many / rate / average
            → POST /v1/semantic/query
                 product: webtracking
                 agent: webtracking.analytics
                 metrics: ["web_session_volume", …]
                 time / group_by / filters as structured fields (not NL)

Dashboard snapshot (Insights panel)
  → InsightsAgent
       ├─ system prompt = slice.prompt from webtracking.insights
       └─ narrate snapshot only (no semantic required)
```

**Do not send the user’s raw sentence as the semantic body.** Map the utterance to certified `metrics[]` (+ optional `time` / `group_by` / `filters`) in your agent code.

---



## 1. Hard rules

1. `product` **is always** `"webtracking"`**.** Other products (`ticketing`, `contact_centre`, …) will reject or return the wrong ontology / metrics.
2. `agent` **is exactly one of the registered product ids** in §2. Prefer `agent` over `preset`.
  - Chat co-worker (ontology **and** KPIs) → `webtracking.analytics`  
  - Insights panel (ontology) → `webtracking.insights`  
  - Never send `"AnalyticsAgent"` / `"InsightsAgent"` as the `agent` field — those are product names, not Context Layer ids.
3. `organizationId` **+** `userId` **are required on semantic.** Pass `userId` on slice so Analytics gets role-scoped `metrics[]` packed outside the prompt.
4. **Ontology prompt is data-only.** Inject `prompt` as-is. Do not merge module YAML or invent entities. Guardrails live in `ontology.business_rules` inside that YAML.
5. **Semantic body is structured only.** Fields: `metrics`, optional `time`, `group_by`, `filters`, `limit`. **No** natural-language `query` / `instruction` field on `/v1/semantic/query`.
6. **Tenant isolation:** every analytics answer is about **one website**. Product analytics tenant key is `website_id` (see §4.5). Do not mix sites.
7. **Unknown agent id → 400.** Register new workers in `ontology/agents.yml` + preset in `ontology/presets/webtracking.yml`, then `POST /v1/admin/reload` (or restart the API).
8. **Writes / ingest stay in Web Tracking.** Context Layer is read-only.

---



## 2. Registered agent ids


| Context Layer `agent`       | Preset                  | Ontology slice                                            | Semantic KPI allowlist                                                                                                                       |
| --------------------------- | ----------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `webtracking.analytics`     | `webtracking.analytics` | **Full** file: entities, relations, business rules        | **Full** certified webtracking catalog (~85 ids). Same id on `/v1/semantic/query`. Slice returns non-empty `metrics[]` when `userId` is set. |
| `webtracking.reporting_mas` | `webtracking.analytics` | Same as Analytics (alias)                                 | Same full catalog — preferred harness / reporting id                                                                                         |
| `wt.reporting_mas`          | `webtracking.analytics` | Same as Analytics (alias)                                 | Same full catalog — short alias accepted on semantic                                                                                         |
| `webtracking.insights`      | `webtracking.insights`  | **Subset** (cause-effect chain) + **full** business rules | **Empty** — Insights narrates the dashboard snapshot                                                                                         |




### 2.1 Insights subset (exact allowlist)

Insights receives only these entities (relations kept when both ends are in the set):

`Tenant`, `Website`, `Visitor`, `Session`, `Page`, `PageView`, `TrafficSource`, `Campaign`, `Conversion`, `PerformanceMeasure`, `Error`

Analytics receives **all** entities from `ontoYMLs/webtracking.yml` (including `KnownUser`, `Interaction`, `Form`, `FormEvent`, `Product`, `ProductAction`, `CustomEvent`, …).

### 2.2 Id aliases — do not use these on the wire


| Wrong                                          | Right                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `AnalyticsAgent`                               | `webtracking.analytics`                                               |
| `InsightsAgent`                                | `webtracking.insights`                                                |
| `wt.analytics` / `wt.insights`                 | not registered — use `webtracking.analytics` / `webtracking.insights` |
| Intent / SQL / plot “agents” from legacy stack | not registered — capabilities only                                    |


**Accepted KPI agent ids:** `webtracking.analytics`, `webtracking.reporting_mas`, or `wt.reporting_mas` (aliases share the same grants). Prefer `webtracking.analytics` in product chat; harness may use `wt.reporting_mas`. Unknown ids → **400**.

---



## 3. Ontology — `POST /v1/ontology/slice`

Ontology answers: **what entities, relations, synonyms, taxonomy, and business rules this agent may use.**

It does **not** hold live sessions, ClickHouse SQL, or metric formulas.

### 3.1 Request

```http
POST /v1/ontology/slice
Content-Type: application/json
```

**AnalyticsAgent (full ontology + metric grants):**

```json
{
  "organizationId": 1000,
  "userId": 42,
  "product": "webtracking",
  "agent": "webtracking.analytics",
  "format": "prompt"
}
```

**InsightsAgent (subset ontology):**

```json
{
  "organizationId": 1000,
  "userId": 42,
  "product": "webtracking",
  "agent": "webtracking.insights",
  "format": "prompt"
}
```


| Field                                    | Required    | Notes                                                              |
| ---------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `organizationId`                         | yes         | Tenant                                                             |
| `userId`                                 | recommended | When set, Analytics response includes `metrics[]` / `entitlements` |
| `product`                                | yes         | `"webtracking"`                                                    |
| `agent` **or** `preset` **or** `modules` | exactly one | Prefer `agent`                                                     |
| `format`                                 | no          | `prompt` (default), `debug`, `verbose`, `json`                     |


- Do not use this endpoint for Hub (`hub.orchestrator` → `POST /v1/ontology/hub` with `products: ["webtracking", …]`).
- `format: "verbose"` — debug/admin only; do not inject every turn.
- `format: "json"` — compiled slice object for tooling (`product_ontology` for webtracking).



### 3.2 Response (what to do with it)


| Field                               | Use                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt`                            | **Data-only ontology YAML** — append to this worker’s system prompt. Shape: `ontology:` → `name`, `purpose`, `entities`, `relations`, `synonyms`, `taxonomy`, `business_rules`. **No** routing rules, **no** `wt:`* ids, **no** KPI formulas inside the YAML. Cache until deploy / entitlement change / admin reload. |
| `metrics`                           | When `userId` was sent: certified metric descriptors this agent may use on semantic. **Populated for** `webtracking.analytics`; empty for Insights. Returned **outside** the YAML `prompt`.                                                                                                                           |
| `entitlements`                      | SKUs / features for this org                                                                                                                                                                                                                                                                                          |
| `version`, `industryPack`, `tenant` | Metadata for cache keys                                                                                                                                                                                                                                                                                               |


**Inject only** `prompt` **into the LLM system prompt.** Keep Analytics `metrics[]` as the allowlist hint for semantic client calls.

### 3.3 Example `prompt` shape (abbreviated)

```yaml
ontology:
  name: web_tracking_ontology
  purpose: >
    Give the Web Tracking agents a complete and simple understanding of the
    product ...
  entities:
    Tenant: { ... }
    Website: { ... }
    Visitor: { ... }
    # ... full or subset ...
  relations:
    - Tenant - owns -> Website
    - Visitor - has_session -> Session
    # ...
  synonyms: { ... }
  taxonomy: { ... }
  business_rules:
    - Every answer is about one website only. Never mix data from two websites.
    - A visitor is a person, a session is one visit, and a page view is one page opening. ...
    # ... 25 rules total — same list for every webtracking product agent ...
```



### 3.4 curl smoke

```bash
# Analytics — expect 18 entities + non-empty metrics[] when userId set
curl -s http://localhost:8765/v1/ontology/slice \
  -H 'Content-Type: application/json' \
  -d '{
    "organizationId": 1000,
    "userId": 42,
    "product": "webtracking",
    "agent": "webtracking.analytics",
    "format": "prompt"
  }' | jq '{metrics: (.metrics|length), prompt_head: (.prompt|split("\n")[:20])}'

# Insights — expect 11 entities, still 25 business_rules; metrics empty
curl -s http://localhost:8765/v1/ontology/slice \
  -H 'Content-Type: application/json' \
  -d '{
    "organizationId": 1000,
    "userId": 42,
    "product": "webtracking",
    "agent": "webtracking.insights",
    "format": "prompt"
  }' | jq '{metrics: (.metrics|length), prompt_head: (.prompt|split("\n")[:20])}'
```

Offline check:

```bash
python3 scripts/validate_webtracking_product_ontology.py
```

---



## 4. Semantic — `POST /v1/semantic/query`

Web Tracking certified KPIs are served by **pre-approved SQL templates** on ClickHouse (`semantic/sql/metric_templates/webtracking.yml`, mirrored in `sql_agent/kpi_templates/webtracking.yml`) — **not** by LLM SQL, and **not** by inventing formulas in the agent.

Requirements catalog: `[webtracking_docs/WEB_TRACKING_AGENT_SEMANTIC_LAYER.md](../webtracking_docs/WEB_TRACKING_AGENT_SEMANTIC_LAYER.md)`.

### 4.1 What Web Tracking needs to understand


| Concept                 | What it means for you                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Certified metric id** | Stable string (`web_session_volume`, `bounce_rate`, …). Agent maps NL → id. Never send free-text as a metric.                                                                                                          |
| **Same agent for chat** | `webtracking.analytics` is used for **both** ontology slice and semantic KPI calls.                                                                                                                                    |
| **ClickHouse marts**    | Runtime reads `webtracking_marts.`* (dbt from silver `web_tracking`). Dashboard CH refs and semantic must agree after the same filters.                                                                                |
| **Org vs website**      | API requires `organizationId`. Product analytics isolation is `website_id` (logged-in site). Expect semantic to scope to that site; do not compare org-wide totals to a single-site dashboard without the same filter. |
| **Rates are percent**   | Product docs define `bounce_rate`, `*_rate` as **percent** (e.g. `42.35`), not 0–1 ratios. Compare harness / UI accordingly.                                                                                           |
| **Bounce**              | **Only** `v_session_bounce` (1 pageview + duration < 10s). Never invent bounce from session row flags alone.                                                                                                           |
| **Counts**              | Visitors / sessions use `uniqExact(visitor_id)` / `uniqExact(session_id)` — never `count()` rows on dim tables.                                                                                                        |
| **Period pills**        | Dashboard `today | week | month | overall` map to semantic `time.period` (or explicit `start`/`end`). Same pill must change the number.                                                                                |
| **No NL on semantic**   | Your agent authors structured JSON. Tier-1 KPIs must not fall back to LLM when the template fails.                                                                                                                     |
| **Ontology ≠ numbers**  | Slice teaches bounce *meaning*; semantic returns bounce *value*. Both are required for a correct chat answer.                                                                                                          |


```
Utterance: "What's our bounce rate this week?"
  → agent resolves:
       metrics: ["bounce_rate"]
       time: { "period": "week" }
       agent: "webtracking.analytics"
       product: "webtracking"
  → POST /v1/semantic/query
  → rows: [{ "bounce_rate": 42.35 }]
  → LLM narrates using ontology rules (one website, bounce definition)
```



### 4.2 Who may call it


| Context Layer `agent=`  | Entitled for semantic?           | Notes                                 |
| ----------------------- | -------------------------------- | ------------------------------------- |
| `webtracking.analytics` | **Yes** — full certified catalog | AnalyticsAgent KPI tool calls         |
| `webtracking.insights`  | **No**                           | Snapshot narrator — no semantic grant |


Org must be entitled to the webtracking SKU or spoke calls return **403**.

### 4.3 Request

```http
POST /v1/semantic/query
Content-Type: application/json
```

**Scalar KPI (dashboard period pill):**

```json
{
  "organizationId": 1003,
  "userId": 1019,
  "product": "webtracking",
  "agent": "webtracking.analytics",
  "websiteId": 1001,
  "metrics": ["web_session_volume"],
  "time": { "period": "week" }
}
```

**Explicit date range:**

```json
{
  "organizationId": 1003,
  "userId": 1019,
  "product": "webtracking",
  "agent": "webtracking.analytics",
  "websiteId": 1001,
  "metrics": ["page_views", "unique_visitors"],
  "time": { "start": "2026-09-14", "end": "2026-09-20" }
}
```

**Breakdown (group by):**

```json
{
  "organizationId": 1003,
  "userId": 1019,
  "product": "webtracking",
  "agent": "webtracking.analytics",
  "websiteId": 1001,
  "metrics": ["web_session_volume"],
  "group_by": ["country"],
  "limit": 20
}
```


| Field                      | Required | Notes                                                                                                                                     |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `organizationId`, `userId` | yes      | Tenant + calling user                                                                                                                     |
| `product`                  | yes      | `"webtracking"`                                                                                                                           |
| `agent`                    | yes      | `webtracking.analytics` (or `webtracking.reporting_mas` / `wt.reporting_mas`)                                                             |
| `websiteId`                | **yes**  | Logged-in site. Missing → `website_id_required`. Site not owned by JWT org → `website_not_entitled` (HTTP 403). Owned empty site → 200/0. |
| `metrics`                  | yes      | Certified ids. `minItems: 1`. **Not** NL. Prefer **one metric per request** when using `group_by`.                                          |
| `group_by`                 | no       | Short names (`country`, `device`, `page_path`, …) or docs aliases (`web_sessions__country`)                                               |
| `filters`                  | no       | `{ "dimension", "op", "values" }` — e.g. device = mobile                                                                                  |
| `time`                     | no       | `period` (`today`, `week`, `month`, `overall`, `last_7_days`, …) and/or `start`/`end`; optional `grain` (`day`/`week`/`month`) for trends |
| `limit`                    | no       | 1–500, default 50                                                                                                                         |


**Do not send** a natural-language `query` / `instruction` field.

### 4.3.1 Website entitlement

Before execute, the API checks `webtracking_marts.mart_web_sites` for `(organization_id, website_id)`.

| Case | HTTP | Code |
| ---- | ---- | ---- |
| Missing `websiteId` | 400 | `website_id_required` |
| Site not owned by request org | 403 | `website_not_entitled` (body includes requested `websiteId`) |
| Site owned, no traffic in period | 200 | rows with `0` |

SQL templates always keep `organization_id = %s`; entitlement does not replace that predicate.

### 4.4 Response (client shape)

```json
{
  "rows": [{ "web_session_volume": 56 }],
  "status": "ok",
  "threshold": null
}
```

Multi-metric: `status` / `threshold` may be objects keyed by metric id (from `semantic/metric_thresholds.yml` when configured).

### 4.5 Execution path (server-side — you do not choose)


| Query shape                            | Path                                          | Warehouse                              |
| -------------------------------------- | --------------------------------------------- | -------------------------------------- |
| Scalar / period / `group_by` / filters | **SQL template only** (`source=sql_template`) | ClickHouse `webtracking_marts.`*       |
| MetricFlow / Postgres                  | **Hard-disabled** for webtracking             | Would raise if a template were missing |


Templates encode dashboard-aligned recipes (bounce from `v_session_bounce`, rates as **percent** 0–100, dual-slot time for session⋈event metrics). Tier-1 metrics must **refuse LLM fallback** if the template/warehouse fails.

Reference SQL (org 1003 / site 1001): `[webtracking_docs/WEBTRACKING_CH_REFERENCE_SQL.md](../webtracking_docs/WEBTRACKING_CH_REFERENCE_SQL.md)`. CI: `scripts/check_webtracking_template_sync.py`, `scripts/validate_webtracking_ch_refs.py`.

dbt project: `semantic/dbt/webtracking/default/dbt` → schemas `webtracking_staging` / `webtracking_marts`.

### 4.6 Time periods (dashboard pills)

**Timezone basis:** period pills use **`SEMANTIC_CALENDAR_TZ` (default `UTC`)**, not the API host’s local TZ and not per-org/per-site TZ. ClickHouse marts store UTC timestamps (`DateTime64(..., 'UTC')`); date filters are applied as date literals on those columns. Set `SEMANTIC_CALENDAR_TZ` to the dashboard’s calendar TZ (e.g. `Asia/Kolkata`) when deploy must match site-local pills.


| Dashboard pill | Semantic `time`                                  | Notes                                                                 |
| -------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| today          | `{ "period": "today" }`                          | Calendar day in `SEMANTIC_CALENDAR_TZ` (default UTC)              |
| week           | `{ "period": "week" }`                           | Align with dashboard week definition                                  |
| month          | `{ "period": "month" }`                          | **Calendar** month unless `WEBTRACKING_MONTH_ROLLING=1` (see below)   |
| overall        | `{ "period": "overall" }` or omit `time`         | All-time                                                              |
| Custom range   | `{ "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }` | Inclusive date bounds on the metric’s time column                     |


Also supported: `last_7_days`, `last_30_days`, `this_quarter`, … (see `semantic/time_resolver.py`).

**Month rolling (`WEBTRACKING_MONTH_ROLLING`):** set to `1`/`true`/`yes` on the Context Layer deploy for go. Then `month`, `this_month`, and `current_month` map to the same bounds as `last_30_days`. Other products keep calendar-month bounds. If unset, webtracking `month` is calendar month-to-date.

### 4.7 Headline Tier-1 metric ids

Use these for dashboard KPI cards / period pills (full catalog is larger — see grants on `webtracking.analytics`):


| Metric id                                       | Unit        | Guardrail                         |
| ----------------------------------------------- | ----------- | --------------------------------- |
| `unique_visitors`                               | count       | `uniqExact(visitor_id)`           |
| `web_session_volume`                            | count       | `uniqExact(session_id)`           |
| `page_views`                                    | count       | page load events                  |
| `total_clicks`                                  | count       | click events                      |
| `total_conversions`                             | count       | conversion events                 |
| `bounce_rate`                                   | **percent** | `v_session_bounce` only           |
| `bounce_count`                                  | count       | same bounce definition            |
| `average_session_duration`                      | seconds     | dashboard activity-span recipe    |
| `new_visitor_count` / `returning_visitor_count` | count       | period session counts per visitor |
| `online_visitors`                               | count       | certified CH template; `is_online_flag` (~5 min, CH `now64`) |


Tier-2 (forms, rage/dead clicks, revenue, vitals, …): same endpoint; ids in `[WEB_TRACKING_AGENT_SEMANTIC_LAYER.md](../webtracking_docs/WEB_TRACKING_AGENT_SEMANTIC_LAYER.md)`.

### 4.8 Dimensions & breakdowns

Prefer **short** dimension names when calling the API (`country`, `device`, `browser`, `utm_source`, `page_path`, `form_id`, `city`, …). **Every certified webtracking metric** may use any categorical dimension declared in [semantic_layer.yml](../semantic/dbt/webtracking/default/dbt/models/semantic_layer/semantic_layer.yml). If the metric’s mart lacks the column, the template path joins the owning mart on `organization_id` + `website_id` + `session_id` (or `visitor_id`). Unjoinable dims return `dimension_not_joinable` (400), not a ClickHouse unknown-column error.

**One metric per `group_by` request.** Split dual ranking questions into two calls.

New websites: they become queryable when present in `webtracking_marts.mart_web_sites` (matching JWT `organizationId`) and have rows in the mart views. No application code change. Deploy `WEBTRACKING_MONTH_ROLLING=1` for rolling month pills.

Product docs also list prefixed ids (`web_sessions__country`, `page_views__page_path`, …). Context Layer maps those to the semantic catalog when aliases are enabled. Wrong or unknown dims → **400**.

Ranking / list intents (top pages, geo breakdown, …) = metric + `group_by` + `order_by` / `limit` — same endpoint.

### 4.9 Errors you will see


| HTTP / message                    | Meaning                                     | What to do                                  |
| --------------------------------- | ------------------------------------------- | ------------------------------------------- |
| 400 Metric not entitled for agent | Wrong `agent` (e.g. Insights or unknown id) | Use `webtracking.analytics`                 |
| 400 Metric is not certified       | Typo / unknown id                           | Use catalog ids only                        |
| 400 Dimension … does not          | Dim not allowed / wrong name                | Use short name or docs alias                |
| 403 not entitled to product       | Org missing webtracking SKU                 | Fix entitlements                            |
| 503 / warehouse error             | ClickHouse / mart unavailable               | Retry; do **not** LLM-invent Tier-1 numbers |




### 4.10 curl smoke

```bash
curl -s http://localhost:8765/v1/semantic/query \
  -H 'Content-Type: application/json' \
  -d '{
    "organizationId": 1003,
    "userId": 1019,
    "product": "webtracking",
    "agent": "wt.reporting_mas",
    "websiteId": 1001,
    "metrics": ["web_session_volume", "bounce_rate", "avg_time_on_page_seconds"],
    "time": { "period": "overall" }
  }' | jq .
```

Offline / warehouse check (SELECT-only against templates):

```bash
# After dbt marts are built for webtracking
PYTHONPATH=. python3 -c "
from semantic.query import SemanticQuery, execute
print(execute(SemanticQuery(
  organization_id=1003, user_id=1019, product='webtracking',
  agent='webtracking.analytics', metrics=['web_session_volume'],
)))
"
```



### 4.11 Source of truth (semantic maintainers)


| Artifact                   | Path                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| SQL templates (ClickHouse) | `[semantic/sql/metric_templates/webtracking.yml](../semantic/sql/metric_templates/webtracking.yml)`                 |
| KPI template mirror        | `[sql_agent/kpi_templates/webtracking.yml](../sql_agent/kpi_templates/webtracking.yml)`                             |
| Agent metric grants        | `[ontology/agent_metrics.yml](../ontology/agent_metrics.yml)` (`webtracking.analytics`)                             |
| Metric ownership           | `[ontology/metric_ownership.yml](../ontology/metric_ownership.yml)`                                                 |
| Metric policies / dims     | `[ontology/metric_policies.yml](../ontology/metric_policies.yml)`                                                   |
| Thresholds                 | `[semantic/metric_thresholds.yml](../semantic/metric_thresholds.yml)`                                               |
| dbt marts                  | `[semantic/dbt/webtracking/default/dbt](../semantic/dbt/webtracking/default/dbt)`                                   |
| Product requirements       | `[webtracking_docs/WEB_TRACKING_AGENT_SEMANTIC_LAYER.md](../webtracking_docs/WEB_TRACKING_AGENT_SEMANTIC_LAYER.md)` |


Keep the two template YAML files in sync. Regenerate grants after ownership changes: `python3 scripts/generate_agent_metrics.py`.

---



## 5. How each agent should use ontology + semantic



### 5.1 `webtracking.analytics` (AnalyticsAgent)

1. Call slice once; put `prompt` in the co-worker system prompt; use `metrics[]` as the semantic allowlist hint.
2. Use entities/synonyms to classify the ask (visitor vs session vs page, traffic source, form vs purchase).
3. Keep follow-ups on the last entity and period unless the user changes them.
4. Obey `business_rules` (one website only; bounce meaning; exit page from last page view; no table names in answers).
5. For how-many / rate / average: call `POST /v1/semantic/query` with `agent: "webtracking.analytics"` and certified metric ids — do not invent SQL for Tier-1.



### 5.2 `webtracking.insights` (InsightsAgent)

1. Call slice once; put `prompt` in the Insights narrator system prompt (shorter entity set is intentional).
2. Interpret snapshot deltas using the cause-effect chain (traffic → landing → bounce → conversion → errors / speed).
3. Never invent numbers not in the snapshot.
4. Recommend dashboard areas (`/`, `/behavior`, `/visitors`, `/sessions`) — not queries or tables.
5. Do **not** require semantic for the Insights panel path.

---



## 6. Source of truth (maintainers)


| Artifact                             | Path                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Product ontology YAML                | `[ontoYMLs/webtracking.yml](../ontoYMLs/webtracking.yml)`                                                 |
| Loader / filter / dump               | `[ontology/webtracking_product.py](../ontology/webtracking_product.py)`                                   |
| Agent registry                       | `[ontology/agents.yml](../ontology/agents.yml)` (`webtracking.analytics`, `webtracking.insights`)         |
| Presets (full vs Insights allowlist) | `[ontology/presets/webtracking.yml](../ontology/presets/webtracking.yml)`                                 |
| Slice short-circuit                  | `[ontology/slice.py](../ontology/slice.py)` (`product=webtracking`)                                       |
| Validator                            | `[scripts/validate_webtracking_product_ontology.py](../scripts/validate_webtracking_product_ontology.py)` |
| Semantic templates / marts           | See §4.11                                                                                                 |


Changing entities or rules: edit **only** `ontoYMLs/webtracking.yml`, then reload the API. Do not duplicate guardrails into preset `prompt.rules` (product YAML owns them).

Changing KPI formulas: edit webtracking SQL templates (+ mirror) and/or dbt marts, then re-run dbt and validate against dashboard CH for the same `website_id`.

---



## 7. Checklist for AI_CHAT integration



### Ontology

- [ ] Analytics chat worker calls slice with `agent: "webtracking.analytics"`, `product: "webtracking"`.
- [ ] Insights panel worker calls slice with `agent: "webtracking.insights"`, `product: "webtracking"`.
- [ ] System prompt receives `response.prompt` only (not verbose dump).
- [ ] Analytics slice with `userId` returns non-empty `metrics[]`.
- [ ] Cache slice until deploy or `POST /v1/admin/reload`.
- [ ] No legacy multi-agent ids; no `wt:` entity prefixes in prompts.



### Semantic

- [ ] KPI tool calls use `POST /v1/semantic/query` with `product: "webtracking"`.
- [ ] Semantic `agent` is `webtracking.analytics` (same as chat ontology).
- [ ] Body is structured (`metrics` + optional `time` / `group_by` / `filters`) — never NL.
- [ ] Dashboard period pills map to `time.period` (`today` / `week` / `month` / `overall`) or `start`/`end`.
- [ ] Compare rates as **percent**; bounce only via semantic (dashboard-aligned), not ad-hoc SQL.
- [ ] Same `website_id` as the logged-in site when validating against dashboard / CH.
- [ ] Tier-1 failures do not fall back to LLM-invented numbers.
- [ ] Org entitled to webtracking SKU (otherwise 403).