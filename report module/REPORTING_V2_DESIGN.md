# Reports & Analytics — V2 Restructure (Domain, SQL, KG)

Status: **Design locked for build.** Replaces the frame/shape design in the current pack.
Model: Gemma 4 26B on vLLM · ~0.7 s per call · 32k context per request.

---

## 1. Why we are restructuring

Findings from the current pack (`reports_analytics_agent_ticketing`) and test harness:

| Finding | Effect |
|---|---|
| The SQL executor's LLM is never called. SQL results go to `present_job()`, a Python formatter. `sql_executor/agent.md` and all `SKILL.md` files are never loaded. | Answers are raw tables and `measure: value (key)` lines. |
| The Domain must squeeze every question into a tiny frame vocabulary (`shape`, `measure`, a few filter fields). | Anything outside the vocabulary is forced into the nearest box and answered wrongly. The Domain prompt grew into an if-this-then-that rule list. |
| `kpi_index_lines()` sends only ids and parameters, not labels, definitions or synonyms. Matching cards are never injected. | The Domain chooses metrics by id alone. |
| `ticket_number` is not a supported filter → "unknown filter field" → repair drops it. | "Show ticket 1611" returns ~200 rows. |
| Agent roster is a fixed column list; the name comes from `MAX(tickets.assignee_name)`. | "Who are the agents" shows raw columns; agents with no tickets have no name. |
| Rankings return up to 10–200 rows and all are printed. | "Which agent has most tickets" gives a full breakdown instead of an answer. |
| `priority` filters fall into a `continue` in `extra_filters_sql`. | Priority filters silently do nothing (except the `high_priority` segment). |
| Names are matched with `ILIKE '%name%'` on name columns instead of resolving to ids. | "Ravi" silently matches "Ravikumar". |
| The Domain LLM computes ISO dates itself. | Occasional date drift. |
| SQL is built by pasting values into strings. | Safety risk. |
| KG `why_breakdown` is a count grouped by one dimension. | Same as a SQL `GROUP BY`; adds no insight. |

---

## 2. Principle

> **Deterministic where correctness matters. Intelligent where understanding matters.**

| Deterministic (Python) | Intelligent (LLM) |
|---|---|
| Certified KPI formulas (templates) | Understanding what the CEO actually wants |
| Tenant, role scope, access matrix | Writing the SQL / Cypher for any question |
| Name → id resolution, time bounds | Choosing supporting context and depth |
| SQL / Cypher validation and execution | Checking that the result answers the question |
| Math: rates, deltas, share of change | Analysing, explaining, recommending |
| Number grounding check on the answer | Writing the CEO answer |

---

## 3. Architecture

```text
User (CEO)
   │
   ▼
Domain — lead analyst                          LLM call 1: understand + plan
   │  tasks in plain language + depth (quick / standard / deep)
   ▼
Python pre-step: time words → UTC bounds, names → ids, early access check
   │
   ├──► SQL executor  LLM writes SQL or calls run_kpi ──► sql_guard ──► Postgres   LLM call 2
   │                                                                   (tasks in parallel)
   └──► KG executor   LLM writes Cypher ──► cypher_guard ──► Neo4j (org database)
   │
   ▼
Python: results → compact facts (totals, top rows, deltas, share of change)
   │
   ▼
Domain review: done, or ONE follow-up round of tasks (deep only)       LLM call (deep only)
   │
   ▼
Domain synthesis: CEO answer                                            LLM call 3
   │
   ▼
Python grounding check: every number in the answer exists in the facts
```

| Depth | Example | LLM calls | Approx. time (0.7 s/call + DB) |
|---|---|---|---|
| Quick | "Show ticket 1611", "Who are the agents" | 3 | ~2–3 s |
| Standard | "What's our SLA breach rate?" | 3–4 | ~3–4 s |
| Deep | "Why did SLA breaches go up?" | 5–6 | ~4–6 s |

Executors never call each other. Only the Domain orchestrates.

---

## 4. Domain — the lead analyst

The Domain has three jobs in one agent: **plan**, **review** (deep only) and **synthesise**.

### 4.1 Plan

For each question the Domain:

1. **Understands** — what is the CEO really asking, what decision are they making, what kind of answer fits: fact, record, list, roster, ranking, trend, comparison, diagnosis.
2. **Chooses a depth:**
   - **Quick** — one task, answer directly. Record lookups, rosters, simple lists.
   - **Standard** — the main fact plus 1–3 supporting facts (previous period, the most relevant breakdown, threshold status).
   - **Deep** — the "why" playbook (§4.3).
3. **Writes tasks** in plain language. It does not write SQL, Cypher, ids or dates.

Task format:

```json
{
  "kind": "plan",
  "understanding": "CEO wants to know if SLA performance is getting worse and where.",
  "depth": "standard",
  "tasks": [
    {
      "id": "t1",
      "executor": "sql",
      "goal": "SLA breach rate this month and last month",
      "kpi": "sla_breach_rate",
      "time": "this month; compare last month",
      "scope": "org",
      "answer_type": "comparison",
      "depends_on": null
    },
    {
      "id": "t2",
      "executor": "sql",
      "goal": "SLA breach rate this month split by queue, worst first",
      "kpi": "sla_breach_rate",
      "time": "this month",
      "scope": "org",
      "answer_type": "ranking",
      "depends_on": null
    }
  ]
}
```

- `kpi` is set when a certified KPI covers the task. **Python then accepts only `run_kpi` for that task** — free SQL is rejected.
- `time` and `scope` are words. Python resolves them.
- Greetings / thanks / non-report messages: `{"kind": "chat", "reply": "..."}`.
- If two readings would change the answer and there is no safe default, the Domain asks one short question. Otherwise it assumes and states the assumption in the answer.
- Cap: 4 tasks per round.

### 4.2 Review (deep only)

After the first round, the Domain sees the compact facts and decides: **done**, or **one follow-up round** to drill into what stood out (e.g. the worst queue). Never more than one follow-up round.

### 4.3 The "why" playbook (deep)

1. **Measure the change** against a baseline (this period vs previous).
2. **Split by dimensions** (queue, priority, channel, category, agent where allowed) and find which segment explains most of the change. Python computes each segment's share of the total change.
3. **Volume or performance?** Did more tickets arrive (mix / volume), or did handling get worse (rate)?
4. **Capacity** — staffing and workload (KG staffing path, open tickets per agent).
5. **Conclude** — what happened, how big, the most likely cause backed by facts, confidence, and the next step.

### 4.4 Synthesis — the CEO answer

Written by the Domain from the facts. The answer shape follows the question:

| Answer type | Style |
|---|---|
| Record ("ticket 1611") | Clean ticket card: subject, status, priority, customer, assignee, age, SLA state |
| Roster ("who are the agents") | Names with role and status, a count, an offer to show workload |
| Ranking ("which agent has most") | Name the top one directly, the next few for context, what stands out |
| KPI / comparison | Headline number → context (vs last period, vs threshold) → what's driving it → next step |
| Diagnosis ("why") | What happened → how big → likely causes backed by facts → what to check or do next |

Rules:

- Answer first, in one line.
- Human labels only — never column keys or ids. Hours rounded, dates readable, "(UTC)" on date ranges.
- Tables only for real lists, max ~10 rows, then offer more.
- Every sentence either states a fact or draws a conclusion from one. No filler.
- State the scope level used (org / own / queue / named person) and any assumption.
- Name not found → say "No customer named 'Acme' was found", not 0. Query ran and matched nothing → say 0 and what was searched.

Example:

> *The SLA breach rate is 18% this month, up from 11% last month. Most of the rise comes from the Billing queue at 34%, where 9 of its 12 breaches are high-priority tickets. Billing also has 6 tickets at risk right now. Worth checking Billing's staffing this week.*

### 4.5 Grounding check

Python extracts every number from the answer and checks it exists in the facts (after formatting/rounding). If any number is missing: regenerate once with the offending numbers listed; if it still fails, fall back to a facts-only answer.

---

## 5. Python pre-step (before executors)

- **Time:** the task's time words → UTC half-open bounds (`:start`, `:end`, and `:cmp_start`, `:cmp_end` for comparisons). Week = Monday–Sunday. No time → no date filter. The LLM never computes dates.
- **Names:** every person / queue / customer / account mention → ids via ranked ILIKE + trigram. One match → use it (and say which). Several → ask. None → "not found".
- **Early access check:** if the requested scope is outside the role matrix (§9), refuse helpfully before any executor runs, and offer what the user can see.

---

## 6. SQL executor

### 6.1 What the LLM receives

- Executor prompt + active skill.
- The task (goal, answer type, KPI if any).
- **Only this role's virtual views** (§9) that are relevant to the task, each with column descriptions.
- **Sample values** for fixed-value columns (this org's actual statuses, priorities, channels, categories).
- Relationships between the views.
- **6–10 worked question → SQL examples**, picked by similarity to the task.
- Resolved parameters it may use: `:org_id` is never exposed; it gets `:start`, `:end`, `:cmp_start`, `:cmp_end`, `:agent_ids`, `:queue_ids`, `:customer_ids`, etc.

### 6.2 What the LLM outputs

One of:

```json
{"tool": "run_kpi", "kpi": "sla_breach_rate", "group_by": ["queue"], "time": "primary", "compare": true}
```

```json
{"tool": "run_sql", "sql": "SELECT t.ticket_number, t.subject, t.status, t.priority, t.customer_name, t.assignee_name, f.open_age_hours, f.resolution_sla_state FROM rpt.tickets t JOIN rpt.ticket_facts f ON f.ticket_id = t.id WHERE t.ticket_number = :ticket_number"}
```

- If the task has a `kpi`, only `run_kpi` is accepted.
- `run_kpi` supports any groupable dimension, segments, scope and compare periods through the certified templates.

### 6.3 `sql_guard` — validation and scoping (no database objects needed)

1. **Parse** with sqlglot (Postgres dialect). Reject unless it is exactly **one** `SELECT` / `WITH` statement.
2. **Tables:** only this role's virtual views (`rpt.*`). Any real table (`ticketing.*`, `pg_*`, `information_schema`) → reject.
3. **Functions:** allowlist only (aggregates, date/time, string, math, `COALESCE`, `CASE`, window functions). Reject `pg_sleep`, `dblink`, `set_config`, `current_setting`, file/system functions, and anything not on the list.
4. **No** comments, multiple statements, `INTO`, locking clauses, recursive CTEs.
5. **Scoping rewrite:** for every virtual view used, Python prepends a scoped CTE and points references at it:

   ```sql
   WITH rpt_tickets AS (
     SELECT <allowed columns for this role>
     FROM ticketing.tickets
     WHERE organization_id = %(org_id)s AND <role scope>
   ),
   rpt_ticket_facts AS ( <_base_ticket.sql with the same scope> )
   <LLM query, with rpt.tickets → rpt_tickets, rpt.ticket_facts → rpt_ticket_facts>
   ```

   Only allowed columns exist inside the CTE, so a forbidden or unknown column simply errors and goes to repair. The LLM's own CTE names may not collide with `rpt_*`.
6. **Parameters** are bound by the driver — never pasted into the string.
7. **Row queries** get a forced `LIMIT` (cap 500). Aggregates don't need one.

### 6.4 Execution

- `SET TRANSACTION READ ONLY` and `SET LOCAL statement_timeout` (session settings — no database objects).
- Results summarised into facts by `facts.py` (§8). The LLM never sees 500 raw rows.

### 6.5 Sanity signals and one repair

Python sends back: row count, whether the row cap was hit, empty result, any database error. The executor gets **one repair** when:

- the database errored, or
- the signals don't fit the task (asked for one ticket, got many rows; asked "which one", got no ordering), or
- the guard rejected the SQL (with the exact reason).

If the repair also fails, the task returns a typed failure and the Domain says what it couldn't get.

---

## 7. KG executor

**Purpose:** relationships and multi-hop questions — not counts. The graph is synced from the same ticketing Postgres data, so plain counts and group-bys belong to SQL.

Good KG questions:

- Who worked on ticket X (assignee, resolver, note authors)?
- Does each queue's staffing match its load?
- Customer → tickets → agents patterns.
- How tickets move between people and queues.

Flow (same pattern as SQL):

- The LLM receives the allowed labels and relationships (`product_edges.yml`), property descriptions, resolved ids, and 6–10 question → Cypher examples picked by similarity.
- It outputs one Cypher string.
- `cypher_guard` (extends the existing `cypher_validate.py`): read-only clauses only, allowed labels and relationships only, forbidden labels rejected, no procedure calls except an allowlist, forced `LIMIT`, org database only, scope predicates injected by Python.
- One repair on error or bad sanity signals.

### 7.1 Product boundary — the org graph holds every product

The org's Neo4j database contains nodes and edges for **all products**. Ticketing traversal must stay inside ticketing nodes and edges. `cypher_guard` enforces this:

1. **Parse, don't pattern-match.** Parse with an openCypher grammar; reject anything unparseable. Check patterns inside `EXISTS {}`, pattern comprehensions and `OPTIONAL MATCH` too.
2. **Explicit labels.** Every node needs a ticketing label (`Ticket`, `Queue`, `Agent`, `Note`, `SLA`, `Contact`) unless its variable was already bound with one.
3. **Explicit, allowlisted hops.** Every relationship needs a type and direction, and the (from label, relationship, to label) triple must be in `product_edges.yml`.
4. **No open traversal.** No variable-length hops (`*`), no `shortestPath` / `allShortestPaths`, no label wildcards (`%`), alternatives (`|`), negation (`!`) or dynamic labels.
5. **Leaf nodes.** `Contact` is reachable only via `(Ticket)-[:raised_by]->(Contact)`; no pattern may continue from it.
6. **No procedures / APOC, no write clauses.** Start labels: `Ticket` or `Queue` only.
7. **Scope + limits.** Python injects role scope predicates on the start node, forces `LIMIT`, runs read-only on the org database with a timeout.
8. **Result check.** Any returned node / relationship / path is checked against the allowlist; anything outside ticketing fails the task.
9. **Tests** for every escape route above.

Open: whether nodes carry a product marker property (then also inject it on every node), and whether `Agent` is shared with other products (then treat it as a leaf except for allowed ticketing edges).

**"Why" is a method, not a store.** The Domain's deep playbook uses SQL for the numbers and KG for the relationships, then reasons over both.

---

## 8. Facts and analysis helpers (Python)

- **`facts.py`** — turns results into compact facts: row count, totals, top N rows with human labels, formatted numbers, the query's scope and time echo, cap-hit flag.
- **`analysis.py`** — deterministic arithmetic the Domain must not do: period delta, % change, each segment's share of the total change, rate vs volume split.
- **`grounding.py`** — the number check on the final answer (§4.5).

---

## 9. Access — virtual views per role

The access matrix is enforced by **which virtual views exist for each role** and what their scoped CTEs contain.

| Role | `rpt.tickets` / `rpt.ticket_facts` contain | Other views | Masking |
|---|---|---|---|
| **Admin** | Whole org | `rpt.agents`, `rpt.queues`, `rpt.notes`, `rpt.audit_events`, `rpt.customers`, KB, recommendations, approvals, notifications — all org-scoped | None |
| **Agent (L1)** | Own tickets + his queue's tickets | `rpt.queues` (his queue only), his queue's resolvers, notes and audit events on visible tickets, customers on visible tickets | **Other agents masked** on queue tickets ("Another agent", no id). He sees queue totals and all resolver metrics in his queue, but cannot rank or compare other agents. No other queues. |
| **Resolver (L2)** | **Own tickets only** (`resolver_id = me`) | `rpt.queue_ticket_counts` — ticket **counts only** for his queue, by resolver, status, priority and created day | Nothing else exists: no agents, no other queues, no rates / CSAT / SLA for others |

"My tickets": admin / agent → `assignee_id`; resolver → `resolver_id`. "Created by me": `created_by_id` (not applicable to resolvers). Defaults when no level is mentioned: admin → org; agent / resolver → own.

Personal-data columns are left out of a role's CTE where not allowed.

---

## 10. Context budget (32k per request)

| Call | Contents | Approx. tokens |
|---|---|---|
| Domain plan | prompt, KPI index with labels + definitions + synonyms, view summary, identity, recent history (summarised), previous facts | ~8k |
| SQL / KG executor | prompt, relevant views with descriptions + sample values, 6–10 similar examples, task, parameter names | ~8k |
| Domain review / synthesis | facts only, answer rules | ~4k |

Order for prefix caching: static prompt → per-tenant + role blocks → per-turn blocks → message.

---

## 11. Files

```text
reports_analytics_agent_ticketing/
├── domain/agent.md                  REWRITE  role, method, depth, output contract, 8–10 examples
├── sql_executor/agent.md            REWRITE  SQL writing rules + examples reference
├── kg_executor/agent.md             REWRITE  Cypher writing rules + examples reference
├── skills/                          KEEP     frontmatter; allowed-tools: run_kpi run_sql / run_cypher
├── product/
│   ├── kpis.yml + sql/              KEEP     certified templates (unchanged)
│   ├── schema.yml                   NEW      virtual views: columns + descriptions, relationships,
│   │                                         sample-value sources, source table per view
│   ├── access.yml                   UPDATE   role → which views, scope predicate per view, masking,
│   │                                         personal-data columns
│   ├── examples/sql.yml             NEW      question → SQL pairs (few-shot)
│   └── kg/                          UPDATE   edges + labels + examples/cypher.yml
├── core/
│   ├── sql_guard.py                 NEW      sqlglot validation + scoped CTE rewrite
│   ├── run_sql.py / run_kpi.py      NEW      execution, read-only transaction, timeout
│   ├── run_cypher.py                NEW      replaces run_graph.py + cypher_compiler.py
│   ├── cypher_guard.py              NEW      extends cypher_validate.py
│   ├── facts.py / analysis.py       NEW
│   ├── grounding.py                 NEW
│   ├── examples.py                  NEW      similarity pick of few-shot examples
│   ├── resolve.py / time.py         KEEP     time moves fully to Python
│   ├── access.py / loader.py        KEEP     updated for views
│   └── templates.py / thresholds.py KEEP
└── tests/                           EXTEND   question bank (§13)

REMOVED: query_frame.py shapes, compiler.py catalog path, dims.py hard-coded tables,
         prepare.py, present.py formatter, cypher_compiler.py, why_breakdown measure
```

---

## 12. Prompt design

- Each prompt: **role → method → output contract → worked examples**. No rule trees.
- Domain role: *lead analyst briefing the CEO*.
- New failure found → add or adjust an example, not a new "if the user says X" rule.
- Prompts never list KPIs, columns or thresholds — those come from injected blocks.
- `temperature: 0` for plan and executor calls; low (e.g. 0.3) for synthesis.

---

## 13. Evaluation

Question bank covering every answer type: record, roster, ranking (singular vs plural), filtered list, KPI, comparison, trend, diagnosis, follow-ups, access denials per role.

For each question:

- **Deterministic checks** — right view / KPI used, filters applied, sensible row count, access respected, numbers grounded.
- **LLM-judge score** against the CEO standard — answers first, correct, useful context, concise.

Run on every prompt or example change.

---

## 14. Build order

1. `schema.yml` + `access.yml` (virtual views per role) and `sql_guard.py` with tests — including the resolver and agent-masking cases.
2. `run_sql` / `run_kpi` with read-only execution, facts, and the certified-KPI enforcement.
3. SQL executor prompt + `examples/sql.yml` + example picker.
4. Domain plan + synthesis prompts, grounding check. Wire quick and standard depth.
5. Question bank + judge; iterate on examples.
6. KG executor (`cypher_guard`, examples) and the deep playbook with `analysis.py`.
7. Update the Streamlit harness to the new flow.

---

## 15. Locked decisions for V2

| # | Decision |
|---|---|
| V1 | The LLM writes SQL / Cypher; Python validates, scopes and runs it. |
| V2 | No database objects for now — scoping via Python-injected CTEs over virtual `rpt.*` views. |
| V3 | Certified KPIs are mandatory for their numbers (`run_kpi` only when a task names a KPI). |
| V4 | Resolver: own tickets only + ticket counts for his queue and its resolvers. Nothing else. |
| V5 | Agent: own + his queue, all metrics, including his queue's resolvers; other agents masked; no other queues. |
| V6 | KG is for relationships and paths; the graph is synced from the same Postgres data. |
| V7 | The Domain plans, reviews (deep only) and writes the answer; every number is grounded by Python. |
| V8 | Time words and names are resolved by Python, never by the LLM. |
| V9 | UTC only; Monday–Sunday weeks. |
| V10 | KG traversal stays inside ticketing nodes and edges: explicit labels and allowlisted hop triples only, no open traversal, Contact is a leaf, results re-checked (§7.1). |
