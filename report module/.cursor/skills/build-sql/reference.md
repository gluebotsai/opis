# build-sql reference

Read this when writing or reviewing a spoke's `product/` files, prompts, or runtime context. The build order is in [SKILL.md](SKILL.md). The done checklist is in [coverage-gate.md](coverage-gate.md).

Pack folder: `reports_analytics_agent_<spoke>_v2/`.

## Who does what

| Piece | Owns | Must not do |
|---|---|---|
| Domain | Path, plain goal, time words, scope words, slice words, answer type, briefing from facts | KPI ids, SQL, Cypher, ISO dates, metric catalog, invented numbers |
| SQL metric skill | Pick one card, or `clarify`, or `needs_free_sql` | SELECT, neighbour-card guess, extra WHERE |
| SQL views skill | One SELECT/WITH on `rpt.*` | Certified formula rewritten as free SQL, physical table names |
| Python | UTC, name→id, tenant, role CTE, bind params, sqlglot, timeout, row cap, one repair, facts, grounding | Regex intent routing, pasting user values into SQL, retrying deny |
| Graph agent | Relationships and paths | Counts and GROUP BY that belong to SQL |

Identity the UI sends, and the model must never invent: `organization_id`, `user_id`, `role`, and `branch_id` or queue ids when the spoke has them.

## Teaching case — user word is not the column

User: "Break down deal count by status."

Deals have no `status` column. On a deal, status means `stage`. Invoice status, lead status, and campaign lifecycle are different columns.

Inventory row:

```yaml
- column: crm.deals.stage
  disposition: expose
  object: deal
  meaning: "Pipeline stage of the deal. When the user says status on a deal, they mean this column."
  user_phrases: [status, stage, pipeline stage]
  not_the_same_as: [invoice status, lead status, campaign lifecycle]
  groupable: true
```

Dimension alias, scoped to the object:

```yaml
aliases:
  deal.status: stage
  deal.stage: stage
  invoice.status: invoice_status
```

The views skill reads the deal column book and groups by `stage`. It does not look for a column named `status` and fail, and it does not use invoice status.

Closed values (stage names) come from this org's sample-value query, not from a hardcoded list in the prompt.

## product/coverage.yml

One row per `schema.table.column` in schemas marked in on the intake. Schemas to decide in or out: the spoke schema, `accounts`, `cdp`, `inventory`, and any shared schema the product reads.

| Field | Required | Notes |
|---|---|---|
| `column` | yes | `schema.table.column` |
| `disposition` | yes | `expose`, `hide`, `join_only`, `derive` |
| `object` | if expose | Business object Domain names |
| `grain` | if expose | What one row is |
| `meaning` | if expose | Business sentence, including the user word if it differs |
| `user_phrases` | if expose | Words a user says for this column |
| `not_the_same_as` | when words collide | Other columns the same word might hit |
| `groupable` | if expose | true only if GROUP BY is meaningful |
| `sample_values_sql` | if closed vocabulary | Distinct query for this org. Not invented literals |
| `hide_reason` | if hide | secret, internal id, or PII the role cannot have |
| `derive_from` | if derive | Columns the value is calculated from |
| `waiver` | if skipped | Reason. Blank waiver fails the gate |

Also on this file:

- `schemas_in` / `schemas_out` copied from intake
- `missing_kpis`: wish-list metrics that have no card yet, each with a reason
- `waivers`: file-level skips with a reason

A column with no disposition means phase 1 is not done.

## product/schema.yml

The model sees and writes only `rpt.<view>`.

| Field | Required | Notes |
|---|---|---|
| `views.<name>.grain` | yes | One sentence. One row means what |
| `views.<name>.description` | yes | Business object |
| `views.<name>.object` | yes | Word Domain uses (`deal`, `campaign`) |
| `views.<name>.source` | yes | SELECT. Must filter tenant with `{org_id}`. Add `{branch_id}` or `{queue_ids}` when the spoke needs them. May inline `{{base_<object>}}` |
| `columns.<col>.type` | yes | Postgres type the model should expect |
| `columns.<col>.description` | yes | Meaning. Say what the column is not, when users mix words |
| `columns.<col>.groupable` | yes | true or false |
| `columns.<col>.user_phrases` | yes | May be empty only for pure join keys |
| `columns.<col>.not_the_same_as` | when words collide | Other concepts |
| `joins[].to` | when a slice lives on another object | Other `rpt` view |
| `joins[].on` | with `to` | Join keys |
| `joins[].why` | with `to` | Which slice this join exists for (region on the company, product name on the product) |

`organization_id` stays inside `source`. It is not a parameter the model fills.

Do not put columns in `source` that the access file then has to leak. Role hiding is a second lock, not the only lock.

Physical names (`crm.deals`, `ticketing.tickets`, `campaign.campaigns`) appear only in `source`, which the model never sees.

## product/dimensions.yml

| Field | Required | Notes |
|---|---|---|
| `dimensions.<id>.meaning` | yes | What the slice is, and what it is not |
| `dimensions.<id>.user_phrases` | yes | User words |
| `dimensions.<id>.not_the_same_as` | when words collide | Other dimension ids |
| `dimensions.<id>.sql_expr.<object>` | yes for each object that can slice this way | Column or expression on that object's grain |
| `aliases.<object.user_word>` | yes | Maps to a dimension id. Key is `deal.status`, not a global `status` |

Alias rules:

- Key is `object.user_word`, not a global word, unless intake proves every object uses the same column.
- `deal.status` → `stage` is correct. A global `status` → `status` is wrong for CRM.
- Python may rewrite Domain `slice` words through this map. If a word is missing, leave it for the model. Do not add a regex intent table.

Time slices `day`, `week`, `month` use the card's `default_time_column`. Week is Monday–Sunday, UTC.

## product/kpis.yml

One card per locked formula. A list, a name lookup, or "show the rows" is not a card. It is free SQL.

| Field | Required | Notes |
|---|---|---|
| id (the YAML key) | yes | snake_case business name: `won_revenue`, not `kpi_12` |
| `label` | yes | Human name |
| `grain` | yes | What is counted or averaged |
| `unit` | yes | campaigns, deals, hours, percent |
| `family` | yes | volume, rate, time, money, quality |
| `aggregation` | yes | count, sum, avg, ratio, scalar |
| `when_to_use` | yes | The user meaning. One or two sentences. This is how the metric skill chooses |
| `when_not` | yes | The neighbour case that must not use this id |
| `not_confused_with` | yes | Other ids. Use `[]` only if there is truly no neighbour |
| `user_phrases` | yes | Phrases that mean this card |
| `definition.numerator` | yes | Locked formula in words |
| `definition.denominator` | yes | `none` if there is none |
| `definition.includes` | yes | Rows in |
| `definition.excludes` | yes | Rows out |
| `default_time_column` | yes | Business date, not "whatever created_at is nearby" |
| `time_kind` | yes | `timestamptz` or `date` |
| `allowed_scope_levels` | yes | Subset of access scope levels |
| `allowed_dimensions` | yes | Subset of dimension ids. Each must have `sql_expr` for this card's object and a working GROUP BY in the template |
| `filters.<name>.column` | every accepted filter | Column filtered. One slot per accepted HITL decision |
| `filters.<name>.join` | if the column is not on this grain | Join text |
| `filters.<name>.param` | per slot | `:region`, `:stage`. Python binds it |
| `unsupported_filters` | every rejected HITL column | `{ name, reason }`. Empty list only if every candidate was accepted |
| `hitl` | yes | `reviewed_by`, `reviewed_at`, `decisions_file` pointing at the signed column list |
| `compare` | if period vs period | true means the template uses `:cmp_start` and `:cmp_end` |
| `admin_only` | yes | true or false. Non-admins do not receive true cards |

### Column decisions (HITL) — required before SQL

Users filter and group by far more than a guessed set of five or six fields. Completeness is decided when the metric is defined, not after production questions fail.

1. List candidate columns: the grain table plus every table that joins to that grain (already on the view). Not every warehouse table.
2. For each candidate, set `use` to `filter`, `dimension`, `both`, or `not_this_metric`.
3. `not_this_metric` needs a reason: internal id, blob, PII, or the predicate would change the locked formula (for example dropping rows from a rate denominator).
4. A person signs the file. Until `hitl.reviewed_by` is set, the metric is not done.
5. Copy `filter` / `both` onto `filters`. Copy `dimension` / `both` onto `allowed_dimensions`. Copy `not_this_metric` onto `unsupported_filters`.
6. Putting an unrelated schema's columns on this metric (inventory on `deal_count` with no join) is a fail. Skipping a joined `region` / `product` / `customer` because it was not in a starter list is also a fail.

Free SQL is for lists, lookups, and filters a person rejected. It is not a backfill for slots nobody listed.

Naming rule: id, label, `when_to_use`, and `when_not` are the product. If two cards could swap text and still sound right, rewrite them before writing SQL.

`missing_kpis` in coverage holds wish-list items with no card. Do not drop them silently.

## product/sql/<kpi_id>.sql

- File name equals the card id.
- Shared grain: `product/sql/_base_<object>.sql`, inlined. Not a card.
- Placeholders: `{{dimension_select}}`, `{{group_by_sql}}`, **every** accepted filter as a bound `:param`, plus `:start`, `:end`, and `:cmp_start`, `:cmp_end` only when `compare: true`.
- No open `{{filters_sql}}` filled with `TRUE`. No string concat of user text, names, or ids. Bind `:start` / `:end`. Do not paste timestamps.
- Many-to-many joins must use `EXISTS` / `COUNT(DISTINCT grain id)`. A `LEFT JOIN` that multiplies grain rows fails the gate.
- Each `allowed_dimensions` entry joins the table that owns the column and groups by `sql_expr` for that object.
- A dimension that errors on this grain is removed from the card or the SQL is fixed. Do not leave it advertised.
- Undeclared dimension or filter: `run_kpi` returns an error the runtime maps to one free-SQL attempt. It does not append WHERE.

Combinations the builder must run, or write and check:

- no dimension, no extra filter
- each allowed dimension alone
- each declared filter alone
- compare window, if `compare: true`

## product/access.yml

| Field | Required | Notes |
|---|---|---|
| `roles.<role>.default_scope` | yes | Used when the user names no level |
| `roles.<role>.my_rows_column` | yes | Assignee, owner, created_by, resolver — the spoke's "my" column. `deny` if the role has no "my" |
| `scope_levels` | yes | org, own, mine, queue, and spoke-specific levels |
| `matrix.<level>.<role>` | yes | `all` or `deny` |
| `views.<role>.<view>.scope` | yes for each view the role can see | Predicate. Tenant is already in the view source |
| `views.<role>.<view>.hide` | if any | Column names removed from the CTE |
| `views.<role>.<view>.mask` | if any | Expression, for example another person's name |
| `personal_data_columns` | yes | Columns that must be hidden or masked per role |

Views omitted for a role do not exist for that role. The model must not be given their column book.

Deny is final. Repair and replan do not run.

## product/examples/sql.yml

Optional. Free SQL only. Each item is a goal plus one SELECT on `rpt.*`. Runtime picks at most a few by similarity. Never inject the file whole. Do not use examples to smuggle rules that `schema.yml` should hold. At most two short examples live inside the active skill file.

## Prompts

### sql_executor/agent.md

Thin. Sections: role, goal, instructions, guardrails, input/output contract, skills (the two names), handoff back to Domain, memory, approval.

Instructions say: follow the one skill Python attached. Do not brief. Do not invent columns, metric ids, dates, or org ids. Output one JSON object.

Memory: working memory for this task, cleared after the tool JSON. No long-term store and no preference store on this surface.

### skills/<spoke>-kpi-meaning/SKILL.md

Loaded only when `path` is `certified_metric`. The user message contains the task and the metric cards.

Procedure:

1. Read `when_to_use` and `when_not` for every card this role received.
2. Reject a card when `when_not` matches the goal.
3. If two cards still match, return `{"tool":"clarify","question":"..."}` with one short question. Do not pick the neighbour.
4. If the goal's slice or filter is in `unsupported_filters`, return `{"tool":"needs_free_sql","reason":"..."}`. If it is missing from the card entirely, still return `needs_free_sql` and treat that as a catalog defect (HITL incomplete).
5. Otherwise return `{"tool":"run_kpi","kpi":"<id>","dimensions":["<id>"]}`. Copy only allowed dimension ids. At most two. Omit the key when there is no slice.
6. Do not write SELECT. Do not rename the id.

### skills/<spoke>-sql-views/SKILL.md

Loaded only when `path` is `free_sql`, or after one `needs_free_sql`.

Procedure:

1. Lock the object named in the goal. Open that `rpt` view.
2. Choose columns from grain, description, `user_phrases`, and `not_the_same_as`. If the user says status on a deal, use the column whose phrases include status (`stage`). Do not search for a physical column named status.
3. A list returns columns a person would read, with LIMIT. It is not `COUNT(*)`.
4. A count with no card is `COUNT(*)` on that view.
5. Names: `ILIKE` with the user's words. Stage, status, and type: exact match from the sample-value block.
6. Use a join only when the column book lists it for this slice.
7. Do not recompute a certified metric by joining CDP or another spoke. If the goal is a certified number, this skill should not be running unless `certified` will be false.
8. Time: `:start` and `:end` only when the payload has them. No window means no date predicate.
9. Return `{"tool":"run_sql","sql":"SELECT ... FROM rpt.<view> ..."}`.

## Runtime context blocks

Built in Python from YAML on each call. Not pasted by hand into `agent.md`.

Metric path:

- the task JSON (no KPI id)
- resolved time echo and `:start` `:end` when bounded
- metric cards for this role (name, grain, when_to_use, when_not, not_confused_with, allowed dimensions with meanings, filters, unsupported_filters)
- the metric skill text

Free-SQL path:

- the task JSON
- resolved time
- column book for this role's views: grain, description, columns, user_phrases, not_the_same_as, joins
- sample values for closed vocabularies in this org
- the views skill text
- at most a few similar examples

Neither path receives `:org_id`, physical schema names, or the other skill.

## Tool results the runtime must understand

| Tool | Runtime |
|---|---|
| `run_kpi` | Fill the template with declared slots only. Run read-only. Facts `certified: true` |
| `run_sql` | sql_guard, scoped CTE, run. Facts `certified: false` when this followed `needs_free_sql`; true path was free SQL from the start, still not a certified metric label |
| `clarify` | Domain asks the user that one question. No second SQL call |
| `needs_free_sql` | Load the views skill once with the reason. Do not loop |
| guard or DB error | One repair turn to the same skill with the exact error. Second failure → one Domain replan. Then stop |
| deny | Stop. No repair |

Fact block includes row count, totals or top rows, time echo, scope echo, cap-hit, and `certified`. Domain writes the briefing only from that block.

## Python engine contract

Same **contract** every spoke. Point modules at this spoke's `product/`. Do not copy another spoke's `run_kpi` implementation (pasted timestamps, `filters_sql: TRUE`). Bind `:start`, `:end`, and every accepted filter param.

| Module | Job |
|---|---|
| `time.py` | User time words → UTC `[start, end)`. Week Monday–Sunday. No window → no date filter |
| `resolve.py` | This spoke's named entities → ids. One match uses it. Several matches ask. None says not found |
| `views.py` | Each `rpt.<view>` becomes a CTE: exposed columns, mask, role scope, tenant already in source |
| `sql_guard.py` | sqlglot Postgres. One SELECT or WITH. `rpt.*` and the query's own CTEs only. Function allowlist. Bound params. LIMIT on row queries. Comments dropped |
| `run_kpi.py` | Load `product/sql/<id>.sql`. Fill slots. Refuse unknown dimension or filter |
| `run_sql.py` | Guard then execute. `SET TRANSACTION READ ONLY` and statement timeout |
| `facts.py` | Compact facts. The model does not see hundreds of raw rows |
| `grounding.py` | Every number in the briefing must appear in the facts. One regenerate, then facts-only. Does not catch a wrong metric that returned a real number |
| `analysis.py` | Period delta, share of change. Domain does not do this arithmetic |
| `loop.py` | One executor repair, one Domain replan, deny stops |

## Domain plan shape

```json
{
  "kind": "plan",
  "understanding": "One sentence of the need.",
  "depth": "quick",
  "path": "certified_metric",
  "tasks": [
    {
      "id": "t1",
      "executor": "sql",
      "path": "certified_metric",
      "goal": "Count deals that are open, in the user's words",
      "time": "this month",
      "scope": "org",
      "slice": ["status"],
      "answer_type": "ranking"
    }
  ]
}
```

`slice` stays user words (`status`), not a guessed column (`stage`). The dimension alias map and the column book resolve it.

`path` on a task may differ when one plan has a metric and a list (two tasks, two skill loads). Cap tasks at two unless the user asks for a deeper pack.

Depth: one number → quick, one task. A headline plus one breakdown → standard, two tasks. Diagnosis that needs the graph is out of this skill; do not fake it with GROUP BY.

## Question bank

Every spoke adds at least:

- A neighbour-metric pair (saved vs ran, booked vs collected, count vs rate). The card `when_not` must separate them.
- A user-word pair (deal "status" → `stage`, or the spoke's equivalent).
- A filter the card does not support, expecting `needs_free_sql` and `certified: false`.
- A role that must be denied before SQL.
- A list that must not come back as `COUNT(*)`.
- A certified dimension that must group with the join, not error.

Deterministic checks: right path, right card or right view, filters present, row count sensible, access held, briefing numbers present in facts. An LLM judge is optional and does not replace those checks.
