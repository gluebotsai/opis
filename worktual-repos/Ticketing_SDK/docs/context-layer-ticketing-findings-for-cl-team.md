# Context Layer — Ticketing Integration Findings (for CL team)

**Audience:** Context Layer team (ontology, semantic/MetricFlow, SQL Super, knowledge graph)  
**Consumer product:** `ticketing`  
**Validated:** 2026-09-17 (smoke) and 2026-09-18 (needed-path matrix)  
**Ticketing client:** Worktual Ticketing MAS (`CONTEXT_LAYER_URL` + `ONTOLOGY_CHAT_URL`)  
**Test tenant:** `organizationId=1000`, `userId=1001` (integer ids per contract)

**Related Ticketing doc:** [ticketing-agents-hierarchy-and-context-layer.md](./ticketing-agents-hierarchy-and-context-layer.md)  
**Raw log:** `ai-agents/logs/cl-validation-2026-09-18.json`

---

## Executive summary

Ticketing’s **client wiring and contract usage are correct** for slice inject, proactive id remap, semantic allowlists, SQL KPI deny policy, and Express fallback when SQL fails.

**Blockers are on Context Layer runtime and API contract clarity**, not missing ontology definitions for reporting:

| Surface | Status | Primary issue type |
|---------|--------|-------------------|
| Ontology slice (`/v1/ontology/slice`) | **Mostly OK** | Content tuning (Super prompt too large); reporting slices good |
| Semantic (`/v1/semantic/query`) | **FAIL under load** | Server timeout / capacity; filter API schema mismatch |
| SQL (`/v1/sql/query`) | **BLOCKED** | Code bug (`schema` kwarg) then server hang after load |
| Knowledge graph (ONTOLOGY_CHAT) | **OK** | No action required from 2026-09-17 run |

**Important:** These failures are **not** because Ticketing pointed at the wrong Postgres database or invented wrong table names. SQL Super uses **natural-language instructions** (no raw SQL from Ticketing). Semantic uses **certified metric ids from your slice**. Where Postgres/marts are involved, the failure is in **CL’s postgres runner or query generation**, not Ticketing misunderstanding the DB schema.

---

## How Ticketing uses Context Layer (reference)

```text
Staff chat / proactive LLM
    → ontology slice injected (POST /v1/ontology/slice)
    → KPI numbers: POST /v1/semantic/query (reporting executors only)
    → Ticket row lists: POST /v1/sql/query (lifecycle executors only)
    → Why / drivers: ONTOLOGY_CHAT knowledge graph (SSE)
    → Writes: Express → Postgres (NOT Context Layer)
```

**Harness agents:** 31 registered ids. Proactive codes (`tiaa`, `rcaa`, …) are **remapped** to harness executor ids before any CL HTTP call.

**Reporting executors (semantic):** `analytics_audit_query_executor`, `insights_analytics_executor`  
**SQL list executors:** `ticket_lifecycle_executor`, `ticket_creation_executor`, `similar_ticket_detection_executor`

---

## What is working (please do not regress)

### Ontology slice — registration and shape

- `GET /health` — MetricFlow warm for ticketing; SQL agent registered.
- All **31** harness agent ids return HTTP **200** on `POST /v1/ontology/slice`.
- Proactive ids (`tiaa`, `dssa`, `rcaa`, `icpa`, `tcaa`) correctly return HTTP **400** (unknown agent) — Ticketing remaps before HTTP.
- Reporting slices (`analytics_audit_query_executor`, `insights_analytics_executor`) include **`metrics[]` with 96 certified metric ids** and per-metric `dims`. This is sufficient for NL → metric id mapping; **no additional metric ontology is required** on CL for reporting.
- Non-reporting executors, Domains, and Super correctly receive **`metrics_count=0`** (no KPI catalog where tools cannot call semantic).

### Semantic — policy and isolated calls

- `open_tickets_metric`, `ticket_volume` (non-headline) returned **200** in 2026-09-17 smoke tests.
- **Entitlement denials work:** `ticket_lifecycle_executor` and raw `tiaa` on semantic HTTP → **400**.
- Invented metric id `ticket_count` → **400** (2026-09-17).
- SQL KPI phrasing `"how many open tickets"` on lifecycle → **400** `kpi_not_allowed` (2026-09-17; before server hang).

### Knowledge graph

- `ask_knowledge_graph` why/what queries returned grounded answers (~1.5k chars) via `ONTOLOGY_CHAT_URL` (2026-09-17).
- **Not a database misunderstanding:** KG narrative is separate from semantic numbers and SQL row lists.

---

## Issues requiring Context Layer action

Each item includes: **root cause category**, **what Ticketing sent**, **what happened**, **whether this is a DB/mart misunderstanding**, and **recommended fix**.

---

### CL-SQL-001 — SQL Super completely unusable (BLOCKER)

| | |
|--|--|
| **Endpoint** | `POST /v1/sql/query` |
| **Severity** | Blocker |
| **Root cause** | **CL code bug** in postgres runner — **not** Ticketing sending wrong SQL or wrong DB schema |

**What Ticketing sends (example):**

```json
{
  "organizationId": 1000,
  "userId": 1001,
  "originProduct": "ticketing",
  "originAgent": "ticket_lifecycle_executor",
  "instruction": "List open tickets assigned to the current user",
  "entityHint": "wt:Ticket",
  "limit": 10
}
```

Ticketing does **not** send table names, SQL text, or a Postgres `schema` name. The instruction is natural language; CL SQL Super is expected to map to marts.

**What happened:**

1. **2026-09-17:** HTTP **500** on all list-style instructions:
   ```text
   run_postgres_query() got an unexpected keyword argument 'schema'
   ```
   This indicates the **SQL agent passes a `schema=` argument** that the deployed `run_postgres_query()` function does not accept. Fix belongs in **Context Layer `sql_agent/`**, not in Ticketing.

2. **2026-09-18:** After semantic load testing, all **18** SQL cases (including KPI deny) **timed out at 30s** with no response — server appeared saturated/hung.

**Instructions tested (all failed):**

- List open tickets assigned to current user  
- By status Open / high priority / Billing queue / assignee me  
- Subject keyword search  
- Last 30 days  
- Notes for ticket 115  
- Audit history for ticket 115  
- Queue depth as row list  
- Overdue / breached SLA / escalated lists  
- Similar tickets to 115 (`similar_ticket_detection_executor`)  
- Recent tickets for create context (`ticket_creation_executor`)  
- Page with `limit=10`  
- KPI deny: `"how many open tickets"` (expected 400; got timeout on 2026-09-18)

**Database / mart misunderstanding?** **No.** Ticketing never addressed Postgres directly. We could not validate mart column names (`ticket_id`, `assignee_name`, `queue_name`) because **no rows were ever returned**.

**CL team action:**

1. Fix `run_postgres_query()` / SQL Super so the `schema` kwarg is supported or not passed incorrectly.  
2. Ensure SQL queries **fail fast** (4xx/5xx in &lt;5s), not 30s hang.  
3. Restore KPI policy: lifecycle + KPI phrasing → **400** `kpi_not_allowed` even under load.  
4. After fix, confirm list instructions return **200** with `rows[]` for org 1000.

**Ticketing mitigation (already shipped):** On SQL 500/timeout, same-turn fallback to Express `list_tickets` (Postgres SoT).

---

### CL-SEM-TIMEOUT — Semantic layer cannot handle needed-path load (HIGH)

| | |
|--|--|
| **Endpoint** | `POST /v1/semantic/query` |
| **Severity** | High |
| **Root cause** | **CL runtime / capacity** — MetricFlow or host saturation — **not** wrong metric ids from Ticketing |

**What Ticketing sends:**

```json
{
  "organizationId": 1000,
  "userId": 1001,
  "product": "ticketing",
  "agent": "analytics_audit_query_executor",
  "metrics": ["<certified_id_from_slice>"],
  "group_by": ["<dim_from_slice>"],
  "time": { "preset": "last_7d" }
}
```

All metric and dimension ids come from **`metrics[]` returned by your own slice API** — not invented by Ticketing.

**What happened (2026-09-18 needed-path matrix):**

- **1,644** planned calls (96 metrics × solo + each listed dim + `last_7d`/`last_30d` + one filter).  
- **1,000** recorded at 12 concurrent workers, 20s client timeout.  
- **25 PASS / 975 FAIL** (921 read timeouts; remainder 422 on filters).  
- After semantic saturation, **sequential SQL also hung** — suggests **shared CL process/resource exhaustion**, not per-request validation errors.

**Database misunderstanding?** **No.** Semantic uses MetricFlow/certified metrics, not ad-hoc SQL. Timeouts indicate **query engine or server cannot complete work in time**, not wrong Postgres table choice by Ticketing.

**CL team action:**

1. Load-test semantic with 96 solo metrics sequentially (no concurrency) — each must return **200 or explicit 4xx** within **5s**.  
2. Add caching / warm MetricFlow for ticketing product.  
3. Rate-limit or queue fairly so one tenant test does not hang SQL and semantic together.  
4. Return **503/504 with clear code** instead of hanging until client timeout.

---

### CL-SEM-SOLO — Most slice-listed metrics do not return values (HIGH)

| | |
|--|--|
| **Endpoint** | `POST /v1/semantic/query` |
| **Severity** | High |
| **Root cause** | **MetricFlow / metric certification vs runtime** — metrics advertised in slice but not queryable |

**What happened:** Of the first **60** of **96** certified ids tested solo:

| Result | Count | Examples |
|--------|------:|----------|
| HTTP 200 | 4 | `accounts_served`, `accepted_recommendations_metric`, `active_customers_metric`, `active_tickets_metric` |
| Timeout | 56 | `average_csat_score`, `assigned_tickets_metric`, first-response/resolution hour metrics, … |

**Database misunderstanding?** **Partially CL-side data model issue, not Ticketing.** If a metric id appears in **`metrics[]` on the slice**, Ticketing and the LLM will use it. If MetricFlow/marts cannot compute it for org 1000, return **fast 4xx** with `detail.code` (e.g. `metric_unavailable`, `no_data`) — **do not hang**. This is **certification vs warehouse readiness**, not Ticketing picking wrong columns.

**CL team action:**

1. Audit all **96** ids: each must either return a value for test org 1000 or **fail fast** with documented error code.  
2. Remove or mark unavailable metrics that are not yet backed by marts.  
3. Document which metrics require non-empty mart data for org 1000 test tenant.

---

### CL-SEM-GROUP — Dimensional breakdowns mostly hang (MEDIUM)

| | |
|--|--|
| **Endpoint** | `POST /v1/semantic/query` with `group_by: [dim]` |
| **Severity** | Medium |
| **Root cause** | Same as CL-SEM-TIMEOUT + **dim certification** |

**What worked (examples):**

- `accepted_recommendations_metric` × `queue_name`, `status`, `ticket_priority`  
- `accounts_served` × `skill`, `priority`, `channel`, `category`, …

**What failed:** **747/767** group_by calls timed out.

**Database misunderstanding?** **No on Ticketing side.** Dimensions listed on the slice must be valid for `group_by`. If a dim is listed but not groupable, reject with **422** and list allowed dims — do not timeout.

**CL team action:**

1. Ensure every dim in slice `metrics[].dims` is groupable or remove it from slice.  
2. Fast-fail unsupported `group_by` with clear validation error.

---

### CL-SEM-TIME — Time presets almost never return (MEDIUM)

| | |
|--|--|
| **Endpoint** | `POST /v1/semantic/query` with `time: { "preset": "last_7d" \| "last_30d" }` |
| **Severity** | Medium |
| **Root cause** | **API contract / MetricFlow** — presets may be unsupported or too slow |

**What happened:** **1/119** PASS — only `accepted_recommendations_metric` + `last_7d`. All other time-window calls timed out.

**Database misunderstanding?** **No.** Ticketing sends documented-style presets (`last_7d`, `last_30d`) as Skills instruct. If presets differ, **document the exact `time` object schema** in CL OpenAPI/README.

**CL team action:**

1. Publish supported `time` shapes for ticketing (preset names, or `start`/`end` ISO).  
2. Implement or reject unknown presets in &lt;1s with 422.

---

### CL-SEM-FILTER — Filter body schema mismatch (HIGH — contract)

| | |
|--|--|
| **Endpoint** | `POST /v1/semantic/query` with `filters[]` |
| **Severity** | High |
| **Root cause** | **API contract mismatch** between Ticketing client and CL Pydantic model |

**What Ticketing sent (54 calls, all failed):**

```json
{
  "filters": [
    { "field": "queue_name", "op": "eq", "value": "Billing" }
  ],
  "time": { "preset": "last_30d" }
}
```

**What CL returned:** HTTP **422** on **all 54**:

```text
Field required at body.filters.0.dimension
(input had "field": "queue_name" instead of "dimension")
```

**Database misunderstanding?** **No.** This is purely **JSON field naming**. CL expects:

```json
{ "dimension": "queue_name", "op": "eq", "value": "Billing" }
```

(or equivalent — please confirm full filter schema in docs).

**CL team action:**

1. **Document** the canonical filter object in API spec (required keys: `dimension`, `op`, `value`, optional types).  
2. Optionally accept **`field` as alias for `dimension`** for backward compatibility.  
3. Confirm valid `op` values (`eq`, `in`, …) and whether dimension names must match slice `dims` exactly.

**Ticketing action (separate):** We will map `field` → `dimension` in `ask_semantic_layer` before HTTP.

---

### TK-ONT-008 — Super agent slice too large (MEDIUM — ontology content)

| | |
|--|--|
| **Endpoint** | `POST /v1/ontology/slice` `agent=ticketing_super_agent` |
| **Severity** | Medium |
| **Root cause** | **Ontology content design** — not database |

**What happened:** `prompt_len=11124` characters, `metrics_count=0`.

Super **only routes** (CONTINUE / NEW_TASK / route_to_domain). It **never** calls semantic, SQL, or KG. Injecting ~11k chars of types/actions increases LLM token cost and risk of wrong-layer answers.

**Database misunderstanding?** **No.**

**CL team action:** Provide a **compact Super slice** — routing hints and domain boundaries only. **Do not add `metrics[]` to Super.**

---

### TK-ONT-007 — Reporting ontology is sufficient (INFO — no CL change needed)

Reporting executor slices already include **96 certified metric ids** in `metrics[]` JSON. Prompt prose is shorter; the JSON block is the source of truth.

**This is not a “missing ontology” problem.** The gap is **runtime** (CL-SEM-SOLO/TIMEOUT), not unpublished metric names.

---

## Knowledge graph — no issues found

| Test | Result |
|------|--------|
| Why: “Why are open tickets elevated this week?” | PASS (~1.5k char answer) |
| What: “What themes are driving SLA breaches?” | PASS |

**Not re-tested 2026-09-18** after CL host hang. Recommend smoke re-run after SQL/semantic fixes.

**Database misunderstanding?** **No.** KG uses graph/SSE narrative; it does not replace semantic KPI numbers or SQL row lists.

---

## Ontology slice — per-agent summary (enhancement requests)

| Agent / group | `metrics[]` | Prompt size | CL recommendation |
|---------------|:-----------:|------------:|---------------------|
| `ticketing_super_agent` | 0 | **11,124 chars** | **Shrink** — routing only |
| 5 Domains | 0 | 893–1,759 | OK |
| `analytics_audit_query_executor` | **96** | ~6,249 | **Keep** — full certified catalog |
| `insights_analytics_executor` | **96** | ~6,205 | **Keep** |
| `ticket_lifecycle_executor` | 0 | ~1,337 | OK — SQL/Express rows, not KPIs |
| `root_cause_learning_executor` | 0 | ~834 | OK — KG only |
| Other 22 executors | 0 | 735–1,394 | OK — compact type/action allowlists |

**Proactive remap (Ticketing, not CL):** Never register `tiaa`, `rcaa`, etc. as slice agents; Ticketing maps to harness executor ids.

---

## Policy checks — expected behavior (verified 2026-09-17)

Please keep these behaviors after fixes:

| Case | Expected HTTP | Verified |
|------|---------------|:--------:|
| Semantic from `ticket_lifecycle_executor` | 400 not entitled | Yes |
| Semantic from raw `tiaa` | 400 unknown agent | Yes |
| Semantic with invented metric `ticket_count` | 400/422 | Yes |
| SQL with KPI phrasing on lifecycle | 400 `kpi_not_allowed` | Yes (before hang) |
| Proactive id on slice | 400 unknown agent | Yes |

---

## Org / user id note (tenant mapping)

Live tests used **integer** `organizationId=1000`, `userId=1001`. If production Ticketing JWT uses UUID strings, CL and Ticketing must agree on **id mapping** to these integers (or CL must accept UUIDs). This is **tenant identity**, not Postgres schema confusion.

---

## Suggested verification checklist for CL team (after fixes)

Run sequentially (avoid concurrent hammering until stable):

1. **SQL:** `List open tickets assigned to the current user` → 200 with `rows[]` within 5s.  
2. **SQL KPI deny:** `"how many open tickets"` → 400 `kpi_not_allowed` within 1s.  
3. **Semantic solo:** All **96** metric ids → 200 or fast 4xx within 5s each.  
4. **Semantic filter:** `{ "dimension": "queue_name", "op": "eq", "value": "Billing" }` → 200 or documented 4xx.  
5. **Semantic time:** `last_7d` and `last_30d` on `open_tickets_metric` → 200.  
6. **Semantic group_by:** One dim per headline metric → 200 or fast 422.  
7. **Slice:** Super prompt &lt; 3k chars; reporting still has 96 metrics.  
8. **KG:** One why + one what query → success.

---

## Ticketing-side fixes (for awareness — not CL blockers)

These are Ticketing repo changes; listed so CL knows we are not waiting on you for them:

| ID | Item | Owner |
|----|------|-------|
| TK-SEM-003 | Map filter `field` → `dimension` before HTTP | Ticketing |
| TK-SEM-002 | Enforce slice metric/dim allowlist client-side | Ticketing |
| TK-CAT-001 | Add `ask_sql_layer` to shared MCP catalog | Ticketing |

---

## Contact / contract references

- Ticketing sends `product` / `originProduct`: **`"ticketing"`**  
- Context Layer base: `http://192.168.11.25:8765` (test env)  
- Knowledge graph: `http://82.113.92.44:8000` (test env)  
- Ticketing client modules: `ai-agents/app/tools/catalog_tools.py`, `registry.py`

*Generated from Worktual Ticketing needed-path validation, 2026-09-18.*
