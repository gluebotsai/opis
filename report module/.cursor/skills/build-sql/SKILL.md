---
name: build-sql
description: >-
  Builds a spoke SQL agent and its semantic layer for Reports and Analytics.
  Use when starting a SQL agent for a new spoke, adding certified metrics or
  free SQL, or changing run_kpi, run_sql, schema.yml, kpis.yml, dimensions,
  access, or the middle layer between raw Postgres and the spoke.
---

# Build SQL agent

Standard for a Reports SQL agent on **every** spoke (ticketing, campaign, CRM, contact centre, inventory, accounts, and any new product). The SQL agent is the middle layer between raw warehouse tables and that spoke. It fetches and calculates that spoke's metrics, KPIs, and business-concept data. It does not brief the user. Domain does that.

Do not build a spoke by copying another spoke's metrics, filters, views, or `run_kpi` SQL. Analyse **this** spoke's product language, database, objects, grains, neighbour metrics, columns, joins, filters, dimensions, roles, and time — at the same depth every time. Templates under [templates/](templates/) use a deal-shaped example only to show file shape. Replace every name with this spoke's objects.

Follow [build-nlp-agents](../build-nlp-agents/SKILL.md) for `agent.md` sections and for keeping intent routing off regex. This skill owns the semantic layer and the SQL specialist. Reports tools are `run_kpi` and `run_sql` in the pack runtime. Do not block a spoke on MCP. If a platform later requires MCP, wrap those two tools. Do not add a tool that pastes an extra WHERE onto a certified template.

Existing packs (`reports_analytics_agent_*`) are **history**, not the recipe. Use them only to see file layout. Do not copy their `run_kpi` (timestamp pasting, `{{filters_sql}}` = `TRUE`, Domain picking KPI ids). Do not edit those packs unless the user asks.

Field-by-field contracts: [reference.md](reference.md). Done checklist: [coverage-gate.md](coverage-gate.md). Skeletons: [templates/](templates/).

## Analysis standard (every spoke, before YAML)

Stay here until intake answers are specific. Guessing from another spoke is a fail.

1. **Product** — what the spoke sells/operates; dashboard numbers it already claims; industry metrics it must not miss; neighbour pairs (count vs rate, booked vs collected, saved vs ran, volume vs age).
2. **Database** — list every schema this product reads: the spoke schema, `accounts`, `cdp`, `inventory`, and shared. Each table in or out with a reason. Draw the join graph (which table owns the grain, which tables attach attributes). Mark many-to-one vs many-to-many (fanout).
3. **Objects** — user words (ticket, deal, campaign, contact, invoice, …) mapped to the owning table. One object, one grain. Do not mix objects on one metric.
4. **Columns** — every column: meaning in this spoke, user phrases, collisions with other objects (status ≠ stage ≠ lifecycle), closed vocabularies (distinct values from this org, not invented), PII, internal ids.
5. **Metrics** — wish list from dashboards + industry. Each metric: grain, formula, includes/excludes, time column, neighbour `when_not`.
6. **Filters and dimensions** — for each metric, every expose/join_only column on that grain and its join graph. HITL: filter / dimension / both / not this metric. Not a short list copied from CRM or campaign.
7. **Access and time** — roles, "my rows" column, extra scope keys (`branch_id`, queue ids, or none). UTC, Monday–Sunday week, which timestamp or date is the business window for each metric (launch vs created vs sent vs resolved — it differs by spoke and by metric).

## Non-negotiables

1. Domain outputs a plan only: `path` (`certified_metric` or `free_sql`), `goal` in plain language, `time` as the user's words, `scope` as words, `slice` as the user's breakdown words, `answer_type`. No KPI id. No SQL. No ISO dates. No metric catalog in the Domain prompt.
2. The SQL executor prompt stays thin. Runtime attaches exactly one skill: metric skill on `certified_metric`, views skill on `free_sql`. Never both. At most two short examples inside the active skill. Do not put 8–10 examples in the executor prompt.
3. Metric skill returns only `run_kpi`, `clarify`, or `needs_free_sql`. It does not write SELECT. Views skill returns only `run_sql` on `rpt.*`.
4. If two metric cards both match and `when_not` does not separate them, return `clarify`. Do not pick the neighbour card.
5. `needs_free_sql` is only for a slice or filter a person marked `not_this_metric` (or for a list Domain sent down the metric path by mistake). Runtime runs that task once on the views skill. Facts set `certified: false`. If `needs_free_sql` fires because a joined column was never listed, stop and fix HITL — do not treat that as normal.
6. Certified SQL accepts only declared dimension slots and declared filter slots. No runtime string WHERE and no leftover `{{filters_sql}}` filled with `TRUE`.
7. A dimension on a card must have a real GROUP BY and the join that owns that column. Listing `region` without the join fails the gate.
8. Before a metric is done, a person reviews every column on that grain and on every joined table. Each column is **filter**, **dimension**, **both**, or **not this metric** with a written reason. Do not start with five or six guessed slots. Users will ask for columns you did not prepare. A short list is a fail.
9. Python owns UTC bounds, name-to-id, tenant, role scope, bound parameters, sqlglot parse, scoped CTEs, read-only, timeout, row cap, one repair, facts, and grounding. The LLM never computes dates or org ids.
10. Grounding checks that written numbers exist in the rows. It does not prove the right metric was chosen.
11. Counts, rates, lists, rankings, and trends are SQL. "Why" and "who is connected to whom" are not a SQL GROUP BY. Do not build the graph agent here.
12. Aliases are per object. A global map that sends every "status" to one column is forbidden when objects disagree.
13. Column choice uses grain, description, `user_phrases`, and `not_the_same_as`. Word overlap is not enough. The user will not say the physical column name.
14. Schema coverage is a first pass over every in-scope table, including accounts, CDP, inventory, and the spoke schema. A spoke is not done because chat testing reached most questions.
15. Do not write `sql_executor/agent.md` until phases 0–6 pass [coverage-gate.md](coverage-gate.md).

## Already learned — do not repeat

- Domain picking KPI ids made the catalog huge and the SQL agent a copier. Ticketing and CRM still do that. New spokes must not.
- One prompt plus many examples made behavior worse. Load one skill for the path that is running.
- A dimension name on a card is not coverage. The template must join and group by that column. A filter is a named slot with a join, not a free extra WHERE.
- Guessing five or six filters left production questions unanswered. Analyse every grain and join column on the first pass. HITL signs the list. Free SQL is not where a forgotten slot is found.
- Free-SQL coverage that appears only after failed questions means the column inventory was skipped.
- Interpreting a user word that is not the column name (deal "status" meaning `stage`, campaign "status" meaning lifecycle, ticket "pending" meaning a status not SLA) is a column-meaning job for **that** spoke. Do not blame the user. Do not copy another spoke's aliases.
- Copying campaign or ticketing `run_kpi` into a new spoke copies their holes (ignored extra filters, pasted dates). The engine **contract** is bound params, declared slots, `clarify`, `needs_free_sql`. Implement that contract from this spoke's `product/`.

## Build order

Copy this checklist and keep it updated:

```
Task Progress:
- [ ] 0. Intake
- [ ] 1. Column inventory (every in-scope column)
- [ ] 2. Virtual views rpt.*
- [ ] 3. Dimensions and per-object aliases (every groupable column)
- [ ] 4. Metric cards + HITL on every grain/join column
- [ ] 5. SQL templates (every accepted slot and dimension actually runs)
- [ ] 6. Access
- [ ] 7. Executor prompt and one skill per path
- [ ] 8. Domain contract (no catalog, no KPI ids)
- [ ] 9. Engine contract wired to this product/ (bound params, no copied run_kpi)
- [ ] 10. Coverage gate — all pass or written waiver
```

### 0. Intake

Copy [templates/intake.yml](templates/intake.yml). Fill it from **this** database and product, before any other YAML. The Analysis standard above must be written into that file (schemas, join graph, objects, neighbour metrics, roles, time per metric if it differs).

Pack folder `reports_analytics_agent_<spoke>_v2/`. Identity the UI sends (`organization_id`, `user_id`, `role`, plus this spoke's extra keys). The LLM must never invent those ids.

### 1. Column inventory

Copy [templates/coverage.yml](templates/coverage.yml) to the spoke `product/coverage.yml`.

One row per column in the in-scope schemas. Disposition is `expose`, `hide`, `join_only`, or `derive`. Exposed rows need object, grain, meaning, `user_phrases`, `not_the_same_as`, groupable, and a sample-value source (a distinct query, not invented literals). Hidden rows need a reason.

Write user-word mappings here first. Pattern (not a CRM-only rule): the user will not say the physical column. Example: "deal count by status" when the column is `stage`. On another spoke the same word "status" may mean ticket lifecycle or campaign lifecycle. Each object's `not_the_same_as` must name the collisions **in this product**.

A column with no disposition means the spoke has not started. Do not grow this file from failed chats.

### 2. Virtual views

Copy [templates/schema.view.yml](templates/schema.view.yml) into `product/schema.yml`.

The model writes only `rpt.<view>`. Physical names never appear in prompts or model SQL. Each view has grain, description, object, a source SELECT that filters `{org_id}` (and this spoke's extra scope keys), **every exposed column** for that object, and **every join** from the intake join graph that a later filter or dimension will need. Do not add joins after a metric is written. Details: [reference.md](reference.md).

### 3. Dimensions

Copy [templates/dimensions.yml](templates/dimensions.yml) to `product/dimensions.yml`.

One id per slice concept. Start from every `groupable: true` column on the object and on its joined views for **this** spoke, not from another pack's dimension list. `sql_expr` is per object. Aliases are scoped (`<object>.<user_word>` → dimension id). A bare global `status: status` is allowed only when every object in **this** spoke shares that column. Python may map slice words through this file. That is a dictionary lookup, not intent routing. If the map has no entry, the model reads meaning.

### 4. Metric cards and HITL

Copy [templates/kpi.card.yml](templates/kpi.card.yml) into `product/kpis.yml`. For each metric, copy [templates/metric-column-decisions.yml](templates/metric-column-decisions.yml) and fill it **before** SQL.

Only locked formulas. Lists and lookups are not metrics.

Candidate columns for a metric = every **expose** and **join_only** column on the grain table + the same on tables on **this metric's** join graph from intake. Skip `hide`. Do not paste unrelated schemas onto the metric. The business date column is owned by Python `time.py` — mark it `not_this_metric` with reason `time window`, not as a filter slot.

For each candidate, one decision:

- **filter** — the formula stays the same; named slot + bound param + join if needed
- **dimension** — GROUP BY is valid; dimension id + `sql_expr` + join
- **both** — users will filter and group by it
- **not this metric** — written reason (blob, internal id, PII, would change the formula). Only these may later use free SQL

A person (`hitl.reviewed_by`, `hitl.reviewed_at`) signs the list. A short list copied from another spoke fails the gate. A column with no decision fails the gate.

Copy accepted filters onto the card. Copy accepted dimensions onto `allowed_dimensions`. Copy rejected names onto `unsupported_filters` with the same reasons. A card whose text could fit two metrics fails the gate. Wish-list metrics with no card stay on `missing_kpis`.

### 5. SQL templates

One file `product/sql/<kpi_id>.sql` from [templates/kpi.sql](templates/kpi.sql). Shared grain goes in `_base_<object>.sql`.

The file contains **every accepted filter slot and every accepted dimension join**, not a sample. Use `{{dimension_select}}` and `{{group_by_sql}}` for dimensions. Use bound `:params` for every accepted filter and for `:start` / `:end`. No concatenated user strings. No open `{{filters_sql}}` hole. `compare: true` uses `:cmp_start` and `:cmp_end`.

Joins that can return many rows per grain (intake fanout: many-to-many) must not multiply the metric. Filter those with `EXISTS` / `IN`, or `COUNT(DISTINCT grain_id)`. A plain `LEFT JOIN` plus `COUNT(*)` is a fail.

Prove: no dimension, each dimension alone, each accepted filter alone. A combination that errors is removed from the signed list or the SQL is fixed. `run_kpi` refuses an undeclared dimension or filter and does not append WHERE.

### 6. Access

Copy [templates/access.yml](templates/access.yml) to `product/access.yml`.

Role, default scope, "my rows" column, matrix, per-view scope, hidden columns, masks, personal-data columns. Deny before the executor. Do not retry a deny.

### 7. Runtime prompts

Only after phases 0–6 pass.

- `domain/agent.md` from [templates/domain.agent.md](templates/domain.agent.md). No metric catalog.
- `sql_executor/agent.md` from [templates/sql_executor.agent.md](templates/sql_executor.agent.md). Working memory for this task only. No long-term store on this surface. Read-only.
- `skills/<spoke>-kpi-meaning/SKILL.md` from [templates/kpi-meaning.SKILL.md](templates/kpi-meaning.SKILL.md).
- `skills/<spoke>-sql-views/SKILL.md` from [templates/sql-views.SKILL.md](templates/sql-views.SKILL.md).

Runtime context is built from YAML, not typed into the prompt:

- Metric path: cards for this role only (drop `admin_only` for other roles).
- Free-SQL path: this role's views, grain, columns, joins, `user_phrases`, `not_the_same_as`, and this org's sample values for closed vocabularies.
- Both: `:start` and `:end` when the phrase had a window. Never `:org_id`.

Optional `product/examples/sql.yml`: the runtime may pick a few by similarity for free SQL only. Never inject the whole file. Examples are not the spec.

### 8. Domain contract

Domain classifies path from meaning. Number, rate, ranking, or trend that a certified metric could cover → `certified_metric`. Rows, names, a lookup, or a HITL-rejected filter → `free_sql`. Task shape: [templates/domain.task.json](templates/domain.task.json). Domain prompt skeleton: [templates/domain.agent.md](templates/domain.agent.md).

`needs_free_sql` is only for filters a person rejected on the HITL list, or for lists. It is not the path for a joined column nobody listed. If facts say `certified: false`, the briefing says the number came from the query, not from the metric label.

### 9. Engine contract

Same modules every spoke, pointed at **this** `product/`. Write or adapt them to the contract below. Do not copy another spoke's `run_kpi` body.

- `time.py` — words to UTC half-open bounds
- `resolve.py` — names to ids
- `views.py` — `rpt.*` to scoped CTE, mask, hide
- `sql_guard.py` — sqlglot, one SELECT/WITH, `rpt.*` only, function allowlist, bound params, LIMIT
- `run_kpi.py` — fill **this card's** declared dimension and filter slots only; bind time and filters; refuse unknown slots; handle `clarify` / `needs_free_sql` at the turn layer
- `run_sql.py` — guard and run
- `facts.py`, `grounding.py`, `analysis.py`, `loop.py` — one repair, then one Domain replan; deny stops

On `needs_free_sql`, run the views skill once. Do not loop. Put `certified: false` on the fact block.

## Stop rules

Stop and fix the phase before continuing when:

- A column has no disposition
- A metric is missing a HITL decision for any grain or join column
- The card has a short filter list copied from another spoke
- Intake join graph or neighbour metrics are empty
- A card lists a dimension the template cannot group by
- An accepted filter is missing from the SQL template
- A rejected column has no written reason
- Domain is given KPI ids or the full catalog
- Both skills are loaded for one task
- The executor prompt holds a pile of examples
- Access deny is retried
- The user word and the column name differ and `not_the_same_as` / `user_phrases` were not written

Fill [coverage-gate.md](coverage-gate.md) before calling the spoke done. A blank waiver is a fail.
