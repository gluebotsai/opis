# Reporting module integration: what changed in `ai_contact_centre`

This file is the changelog of what was added and edited in **this** Contact Center tree to integrate `reports_analytics_agent`, plus the checklist the original product still needs.

**Live pack (what coworker imports):** `apps/nlp/src/app/agents/reports_analytics_agent/`

**Super contract:** `apps/nlp/agents/reports_analytics_agent/agent.md`

**Not the runtime pack:** `ai_contact_centre/reports_analytics_agent/` at the repo root is a stale extra copy. Product must copy the `apps/nlp/src/app/agents/reports_analytics_agent/` tree.

`ai_contact_centre_clone` was not edited. Dashboard pages, dashboard REST, `AnalyticsMCPServer`, and contact / queue / inbox / task / monitoring / conversation_assist agents were not edited.

---

## 1. Flow after integration

```
User (KPI / volume / AHT / SLA / mix / FCR / why did X change)
        ↓
contact_center_super
        ↓  route_to_agent(agent_name=reports_analytics_agent, query=<user text>)
coworker/reports_analytics.py     ← host adapter
        ↓  run_turn(...)
apps/nlp/src/app/agents/reports_analytics_agent/   ← pack
        ↓
Grounded HTML answer
```

Analytics **page panels** (incidents, missed-contact snapshot, forecast, peak hour) still use `AnalyticsMCPServer` + dashboard REST. That is not coworker report chat.

---

## 2. Files added in this folder

### 2.1 Pack — entire directory

`apps/nlp/src/app/agents/reports_analytics_agent/` (~160 files)

| Piece | What it is |
| :--- | :--- |
| `core/turn.py` | Domain turn: plan → SQL and/or KG → facts → grounded brief |
| `core/facts.py`, `core/analysis.py`, `core/grounding.py` | Fact blocks, duration clock (`52m 38s`), number grounding |
| `core/db.py` | Postgres; `connect_dsn` strips Prisma query keys (`schema`, `connection_limit`, …) so product `DATABASE_URL` works with psycopg2 |
| `core/time.py`, `core/resolve.py` | Time words and names → ids (Python, not the LLM) |
| `core/access.py` | Org / mine RBAC |
| `core/llm.py`, `core/loop.py`, `core/loader.py`, `core/context.py`, `core/errors.py`, `core/examples.py` | LLM client, one repair, catalog load |
| `core/sql/` | `run_kpi`, `run_sql`, `sql_guard` (sqlglot), `views`, `templates`, `executor` |
| `core/kg/` | Cypher path; `role.py` reads `accounts.setup_user_product_access` + `accounts.setup_roles` for `product_id = 'contact-center'` |
| `product/schema.yml` | Virtual `rpt.*` views; conversations include `reporting_period_at` |
| `product/kpis.yml` + `product/sql/*.sql` | 46 certified KPIs (AHT, handled, FCR, ASA, …) |
| `product/access.yml`, `product/dimensions.yml`, `product/coverage.yml`, `product/examples/sql.yml` | Semantic layer |
| `product/hitl/` | Per-KPI column decisions (no personal reviewer stamps) |
| `product/product.yml`, `product/intake.yml`, `product/COVERAGE_GATE.md` | Pack metadata |
| `domain/agent.md`, `sql_executor/agent.md` | Pack prompts |
| `skills/cc-user-brief/SKILL.md` | HTML brief |
| `skills/contact_center-kpi-meaning/SKILL.md` | Certified card picker |
| `skills/contact_center-sql-views/SKILL.md` | Free SQL on `rpt.*` |
| `CCAAS_kg_context_agent/` | KG tools, ontology, Cypher; pack-side Bolt retry and HTTP `7474` → Bolt `7687` |
| `tests/` | `test_question_bank.py`, `test_db.py`, `test_rbac.py`, `test_executor_turn.py`, `test_domain_turn.py`, `test_domain_flows.py` |
| `requirements.txt` | Pack extras (`sqlglot`, `psycopg`, `neo4j`, …) — merge into NLP deps if missing |

### 2.2 Host files that did not exist before

| File | Why |
| :--- | :--- |
| `apps/nlp/src/app/agents/coworker/reports_analytics.py` | `run()` and `stream()` call `run_turn` on a thread; pass org / user / role / DSN / `recent_turns` / optional queue ids; fail-closed HTML on pack exceptions |
| `apps/nlp/agents/reports_analytics_agent/agent.md` | Domain leaf; empty `handoff_targets` so `/copilot/stream` treats reports as finished |
| `apps/nlp/tests/unit/test_reports_analytics_integration.py` | Host hooks: factory, Super target, stream is terminal, surface KPI copy |

### 2.3 Accompanying docs (not runtime)

| File | Why |
| :--- | :--- |
| `contact_center_decommissioning_list.md` | This changelog + product copy list |
| `contact_center_metrics_validation.md` | Legacy metric vs certified KPI map |
| `contact_center_reporting_catalog.md` | Catalog coverage |
| `FINAL_SYSTEM_AUDIT_REPORT.md` | Audit findings (ETL / product env out of pack scope) |

---

## 3. Host files edited (glue only)

| File | What changed |
| :--- | :--- |
| `apps/nlp/src/app/agents/coworker/__init__.py` | Import `ReportsAnalyticsAgent`; factory `"reports_analytics_agent": ReportsAnalyticsAgent(**kwargs)` |
| `apps/nlp/src/app/agents/__init__.py` | Export adapter; lazy `importlib` of `app.agents.reports_analytics_agent` |
| `apps/nlp/src/app/agents/definitions.py` | `HANDOFFS["reports_analytics_agent"]`; Super `handoff_targets` includes the pack; `REPORTS_ANALYTICS_AGENT_DEFINITION` with **empty** `handoff_targets`; old `performance_intelligence_domain` / analytics L2 commented |
| `apps/nlp/agents/contact_center_super/agent.md` | KPI, handle time, SLA, mix, volume, FCR, causal why → `reports_analytics_agent`; Super calls `route_to_agent` once and does not narrate the handoff |
| `apps/nlp/src/app/runtime/router.py` | `_needs_further_handoff` — domain with no `handoff_targets` is terminal; `_normalize_reports_handoff` rewrites `analytics` / `performance_intelligence_domain` to the pack **only if** those old names are unregistered; 6s routing timeout applies to Super / L2 only; stream publishes the leaf answer |
| `apps/nlp/src/app/runtime/agent.py` | `ROUTE_TO_AGENT_SCHEMA`: conversation KPIs use `reports_analytics_agent` |
| `apps/nlp/src/app/prompts/coworker.py` | Surfaces `dashboard`, `performance`, `reports`, `analytics`, `contacts-list`, `contacts-detail`, `monitoring`: KPI / AHT / SLA / mix / volume → `route_to_agent` **`reports_analytics_agent`**. Analytics page **keeps** snapshot tools (incidents, forecast, peak hour). Do not use `generate_performance_report` for conversation KPIs |
| `apps/nlp/src/app/runtime/orchestration.py` | Flat fallback: `performance`, `reports`, `dashboard`, `analytics` → `reports_analytics_agent` (three-layer still enters Super first) |
| `apps/nlp/src/app/mcp/registry.py` | `reports_analytics_agent` has **no** MCP servers; home surfaces `performance`, `reports`, `dashboard`, `analytics` |

---

## 4. Pack changes after the first drop-in (copy this tree, not an older zip)

Still only under `apps/nlp/src/app/agents/reports_analytics_agent/`.

| Area | What |
| :--- | :--- |
| DSN | `core/db.py` `connect_dsn` drops Prisma/libpq-incompatible query keys so the pack uses the product `DATABASE_URL` as-is |
| Dashboard card clock | `rpt.conversations.reporting_period_at` = `COALESCE(assigned_at, resolved_at, ended_at, created_at)` — same as cc-core `REPORTING_PERIOD_AT` |
| Card KPI templates | Window on `reporting_period_at`: `total`, `handled`, `resolved`, `transferred`, `resolution_rate`, `avg_handle_time`, `avg_first_response`, `first_reply_sla` |
| AHT | Mean `assigned_at` → `COALESCE(resolved_at, ended_at)` for rows that have assigned **and** an end; period is `reporting_period_at` (not `ended_at` alone) |
| First response / SLA | Start at `assigned_at`; 60s first-reply SLA unchanged; window is `reporting_period_at` |
| Display | Facts format duration KPIs like the dashboard (`52m 38s`); brief uses `unit: clock` |
| Errors | `EXECUTION_ERROR` (query failed) vs `UNAVAILABLE` (no card). One SQL repair on Postgres errors, then a retrieval message — not “measure missing” |
| Planner / free SQL | Domain examples: catalog rates → `certified_metric`; ad-hoc ratios and URL/disposition slices → `free_sql`; aliases `_pct` / `_seconds` |
| KG | One retry on Bolt routing; pack driver maps HTTP `7474` → Bolt `7687`; do not query `c.sentiment` (use SQL `rpt.sentiment_turns`) |

Live / occupancy / FCR-style clocks were not switched to the dashboard period.

---

## 5. What this tree did not change

- `ai_contact_centre_clone`
- Dashboard UI (`apps/web` performance / overview cards)
- Dashboard REST (`apps/cc-core` reporting, `apps/nlp` `dashboard_analytics.py` / `reports.py`)
- `AnalyticsMCPServer` (`apps/nlp/src/app/mcp/servers/analytics.py`) and `dashboard-analytics` skill pack
- Contact, queue, inbox, task, monitoring, conversation_assist, general agents
- Product `.env`, Neo4j ETL, graph ingestion

**Already removed from this integration copy** (original product still has them and must delete them):

- `apps/nlp/src/app/agents/coworker/analytics.py`
- `apps/nlp/agents/analytics/agent.md`
- `apps/nlp/agents/performance_intelligence_domain/agent.md`
- Old factory entry `"analytics": AnalyticsAgent(...)`

---

## 6. What the original product must still do

### 6.1 Remove old coworker reports handling

Do **not** delete dashboard UI or dashboard REST.

| Remove | Path in original NLP | Why |
| :--- | :--- | :--- |
| Old L3 coworker | `apps/nlp/agents/analytics/agent.md` | Answered reports via MCP + 9-metric YAML |
| Old L2 router | `apps/nlp/agents/performance_intelligence_domain/agent.md` | Only handed off to `analytics` |
| Old adapter | `apps/nlp/src/app/agents/coworker/analytics.py` | Thin `Agent` around the old prompt |
| Old fallback prompts | `apps/nlp/src/app/prompts/analytics.py` | Hardcoded analytics coworker strings |
| Definitions | `ANALYTICS_AGENT_DEFINITION`, `PERFORMANCE_INTELLIGENCE_DOMAIN_DEFINITION` | Unregister from `ALL_AGENT_DEFINITIONS` and the coworker factory |
| Factory entry | `"analytics": AnalyticsAgent(...)` in `coworker/__init__.py` | Super must not land on this name |
| 9-metric skill pack | `apps/nlp/src/app/skills/packs/performance-analytics/` | Replaced by 46 certified KPIs in the pack |
| Metric MCP | `apps/nlp/src/app/mcp/servers/metric.py` (`MetricMCPServer`) | Only served that YAML catalog |

Stop using `route_to_agent` names `analytics` and `performance_intelligence_domain` for coworker report chat. Keep the **page** surface name `analytics` for Admin Analytics.

**Do not remove (dashboard product):**

- `apps/nlp/src/app/api/dashboard_analytics.py`
- `apps/nlp/src/app/api/reports.py`
- `apps/nlp/src/app/mcp/servers/analytics.py` (`AnalyticsMCPServer`, including snapshot / hourly / `generate_performance_report` as a **page** tool)
- `apps/nlp/src/app/skills/packs/dashboard-analytics/`
- Web Analytics welcome copy / right-hand diagnostic panels

### 6.2 Copy from this tree

1. `apps/nlp/src/app/agents/reports_analytics_agent/` (the live pack, including section 4 behavior)
2. `apps/nlp/agents/reports_analytics_agent/agent.md`
3. `apps/nlp/src/app/agents/coworker/reports_analytics.py`
4. Host diffs in section 3 (factory, Super, router, schema, surfaces, orchestration, registry)
5. `apps/nlp/tests/unit/test_reports_analytics_integration.py`
6. Merge pack `requirements.txt` into NLP deps if needed

Adapter arguments into `run_turn()` — product does not invent a second API:

| Argument | Source |
| :--- | :--- |
| `question` | User text |
| `organization_id` | Trusted tenant id (int) |
| `user_id` | Trusted user id (int) |
| `role` | Runtime role (`admin` / `agent`, …) |
| `dsn` | NLP `database_url` (Postgres); pack strips Prisma extras |
| `queue_ids` | Optional page queue |
| `recent_turns` | Last few user/assistant messages |

### 6.3 Agent capability

`reports_analytics_agent` owns coworker questions about certified KPIs and rates, volume and mix, trends, “why did X change” (SQL + KG), and grounded lists.

It does **not** own contact-directory CRUD, queue/staffing/live presence, inbox drafts, or Admin Analytics **panel** incidents / forecast / peak hour.

### 6.4 Product must not change

- Contact / queue / inbox / task / monitoring / conversation_assist tools
- Dashboard REST and `AnalyticsMCPServer` snapshot methods
- `stream_direct` (executor-only; reports is a domain leaf via `route_to_agent`)

---

## 7. How to verify

```bash
cd apps/nlp
PYTHONPATH=src .venv/bin/pytest tests/unit/test_reports_analytics_integration.py -q
```

Manual after NLP restart:

1. “average handle time last 7 days” / “last 30 days” → grounded duration in dashboard clock form (e.g. `52m 38s`), **not** stand-by loops, **not** `kind chat HTML`.
2. “handled conversations last 7 days” → certified volume on the same period clock as the overview card.
3. Admin Analytics incident / peak-hour snapshot chat still uses the dashboard snapshot.
4. Contact create / queue staff flows unchanged.

---

## 8. Checklist for the original product repo

1. Delete the **Remove** table in section 6.1 from original NLP.
2. Copy the live pack to `apps/nlp/src/app/agents/reports_analytics_agent/` plus `apps/nlp/agents/reports_analytics_agent/agent.md`. Do not copy the stale root `reports_analytics_agent/` folder as the runtime.
3. Add adapter + factory + Super target + router helpers + surface KPI sentences (section 3).
4. Merge pack `requirements.txt` into NLP deps if needed.
5. Run the integration tests and the manual questions in section 7.
6. Leave dashboard APIs and other agents untouched.
