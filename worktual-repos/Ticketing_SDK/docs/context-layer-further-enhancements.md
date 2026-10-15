# Context Layer — Further Enhancements (Ticketing integration)

**Purpose:** Action list for the Context Layer team after Worktual Ticketing needed-path validation (2026-09-17 / 2026-09-18).  
**Product:** `ticketing`  
**Test env:** `CONTEXT_LAYER_URL=http://192.168.11.25:8765`, `ONTOLOGY_CHAT_URL=http://82.113.92.44:8000`  
**Test tenant:** `organizationId=1000`, `userId=1001`

**Related docs**

- Internal wiring: [ticketing-agents-hierarchy-and-context-layer.md](./ticketing-agents-hierarchy-and-context-layer.md)  
- Detailed findings: [context-layer-ticketing-findings-for-cl-team.md](./context-layer-ticketing-findings-for-cl-team.md)  
- Raw log: `ai-agents/logs/cl-validation-2026-09-18.json`

---

## How to read this document

Each item is tagged:

| Tag | Meaning |
|-----|---------|
| **BLOCKER** | Ticketing cannot use this path in production until fixed |
| **HIGH** | Major feature gap (KPIs, filters, most metrics) |
| **MEDIUM** | UX, performance, or contract clarity |
| **INFO** | Working as designed; optional polish |

**Root cause** is called out so CL can distinguish:

- **API contract** — request/response shape mismatch (not Postgres)
- **CL code bug** — server-side exception (not wrong DB from Ticketing)
- **Runtime / capacity** — timeouts, saturation (not wrong SQL from client)
- **Mart / MetricFlow** — metric certified in slice but not computable for tenant
- **Ontology content** — prompt size or slice shape (not database tables)
- **Not a DB misunderstanding** — Ticketing does not send SQL, schema names, or table names

---

## 1. SQL Super — `POST /v1/sql/query`

### FE-SQL-001 — Fix postgres runner `schema` argument (BLOCKER)

| | |
|--|--|
| **Root cause** | **CL code bug** — not Ticketing misunderstanding the database |
| **Observed** | HTTP **500**: `run_postgres_query() got an unexpected keyword argument 'schema'` |
| **Date** | 2026-09-17 |

Ticketing sends **natural-language instructions only** (no SQL text, no Postgres schema name):

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

**Enhancement:** Align SQL Super with `run_postgres_query()` signature — either accept `schema=` or stop passing it incorrectly.

---

### FE-SQL-002 — Fail fast; do not hang 30s (BLOCKER)

| | |
|--|--|
| **Root cause** | **Runtime / capacity** — not wrong DB connection from Ticketing |
| **Observed** | 2026-09-18: all **18** list cases + KPI deny **timed out at 30s** after semantic load |
| **Impact** | Ticketing falls back to Express `list_tickets`; SQL path unusable |

**Enhancement:**

- Return **4xx/5xx within &lt;5s** with `detail.code`  
- Restore KPI deny under load: `"how many open tickets"` → **400** `kpi_not_allowed` (worked 2026-09-17 before saturation)

---

### FE-SQL-003 — Confirm list instructions return mart rows (HIGH)

After FE-SQL-001/002, validate these **Ticketing-required** instructions (all failed in test):

| # | Instruction | `originAgent` |
|---|-------------|---------------|
| 1 | List open tickets assigned to the current user | `ticket_lifecycle_executor` |
| 2 | Show tickets with status Open | lifecycle |
| 3 | Show high priority tickets | lifecycle |
| 4 | Show tickets in Billing queue | lifecycle |
| 5 | Show tickets assigned to me | lifecycle |
| 6 | Search tickets with subject containing password reset | lifecycle |
| 7 | List tickets created in the last 30 days | lifecycle |
| 8 | Show notes for ticket 115 | lifecycle |
| 9 | Show audit history for ticket 115 | lifecycle |
| 10 | Show queue depth for Billing queue as row list | lifecycle |
| 11 | List overdue tickets | lifecycle |
| 12 | List breached SLA tickets | lifecycle |
| 13 | List escalated tickets | lifecycle |
| 14 | Find tickets similar to ticket 115 | `similar_ticket_detection_executor` |
| 15 | List recent tickets for customer context during create | `ticket_creation_executor` |
| 16 | List open tickets page 1 limit 10 | lifecycle |

**Mart columns (for Ticketing row mapping):** Ticketing normalizes `ticket_id`→`id`, `assignee_name`→`assignee`, `queue_name`→`queue`. We could not verify live rows because SQL never returned 200.

**Not a DB misunderstanding:** Ticketing never specifies mart table names; CL SQL Super maps NL → marts.

---

## 2. Semantic layer — `POST /v1/semantic/query`

### FE-SEM-001 — Every slice-listed metric must respond or fail fast (HIGH)

| | |
|--|--|
| **Root cause** | **Mart / MetricFlow readiness** + **runtime timeout** |
| **Observed** | 96 ids in reporting slice; solo test **4/60 HTTP 200**, **56/60 timeout** |
| **Passed examples** | `accounts_served`, `accepted_recommendations_metric`, `active_customers_metric`, `active_tickets_metric` |
| **Failed examples** | `average_csat_score`, `assigned_tickets_metric`, first-response / resolution hour metrics |

**Enhancement:**

- For each id in `metrics[]` on reporting slices: **200 with value** or **4xx within 5s** (`metric_unavailable`, `no_data`, etc.)  
- Do **not** advertise ids in slice that hang MetricFlow  
- **Not missing ontology:** 96 certified ids already in slice JSON — runtime must serve them

---

### FE-SEM-002 — Semantic server must survive realistic load (HIGH)

| | |
|--|--|
| **Root cause** | **Runtime / capacity** |
| **Observed** | Needed-path matrix: **25 PASS / 975 FAIL** of 1000 calls (921 timeouts at 12 workers, 20s client timeout) |
| **Side effect** | SQL endpoint also hung after semantic saturation |

**Enhancement:**

- MetricFlow warm cache per `(product, org)`  
- Fair queuing / concurrency limits  
- **503/504** with retry hint instead of hanging until client timeout  
- **Not a DB misunderstanding:** requests use certified metric ids from your slice API

---

### FE-SEM-003 — Document and support filter object (HIGH — API contract)

| | |
|--|--|
| **Root cause** | **API contract mismatch** — not Postgres |
| **Observed** | **54/54** filter calls → HTTP **422**: `Field required` at `filters.0.dimension` |
| **Ticketing sent** | `{ "field": "queue_name", "op": "eq", "value": "Billing" }` |
| **CL expects** | `{ "dimension": "queue_name", "op": "eq", "value": "Billing" }` |

**Enhancement:**

1. Publish filter schema in OpenAPI (required: `dimension`, `op`, `value`; valid `op` values; dim names vs slice `dims`).  
2. Optionally accept **`field` as alias for `dimension`**.  
3. Return **422 with allowed dimensions** when filter dim is invalid — not timeout.

Ticketing will map `field`→`dimension` on our side; CL should document canonical shape.

---

### FE-SEM-004 — Time window presets (MEDIUM)

| | |
|--|--|
| **Root cause** | **API contract / MetricFlow** |
| **Observed** | `time.preset=last_7d` / `last_30d`: **1/119 PASS** (`accepted_recommendations_metric` + `last_7d` only) |
| **Ticketing Skills use** | `{ "preset": "last_7d" }`, `{ "preset": "last_30d" }` |

**Enhancement:** Document supported `time` object; implement or **422 fast-fail** unknown presets.

---

### FE-SEM-005 — `group_by` dimensions (MEDIUM)

| | |
|--|--|
| **Root cause** | **Runtime timeout** + dim certification |
| **Observed** | **20/767** group_by passed early; rest timed out |
| **Worked** | e.g. `accepted_recommendations_metric` × `queue_name`, `status`; `accounts_served` × `skill`, `channel` |

**Enhancement:** Every dim listed on `metrics[].dims` must be groupable or removed from slice; invalid `group_by` → **422**, not hang.

---

### FE-SEM-006 — Keep entitlement policy (INFO — do not regress)

Verified 2026-09-17 — please preserve:

| Request | Expected |
|---------|----------|
| Semantic from `ticket_lifecycle_executor` | **400** not entitled |
| Semantic from raw `tiaa` (no remap) | **400** unknown agent |
| Semantic with invented metric `ticket_count` | **400/422** |

---

## 3. Ontology slice — `POST /v1/ontology/slice`

### FE-ONT-001 — Compact Super agent slice (MEDIUM)

| | |
|--|--|
| **Root cause** | **Ontology content design** — not database |
| **Agent** | `ticketing_super_agent` |
| **Observed** | `prompt_len=11124`, `metrics_count=0` |
| **Why it matters** | Super **only routes**; never calls semantic/SQL/KG. Large prompt wastes tokens and risks wrong-layer answers. |

**Enhancement:** Shrink Super slice to **routing hints + domain boundaries** (~&lt;3k chars target). **Do not add `metrics[]` to Super.**

---

### FE-ONT-002 — Keep full reporting `metrics[]` (INFO — working)

| | |
|--|--|
| **Agents** | `analytics_audit_query_executor`, `insights_analytics_executor` |
| **Observed** | **96** certified metric ids + dims in `metrics[]` JSON; prompt ~6.2k chars |
| **Verdict** | **No further metric ontology needed** for NL→id mapping |

**Enhancement:** None required for catalog breadth; pair with FE-SEM-001 so every listed id is queryable.

---

### FE-ONT-003 — Keep empty `metrics[]` on non-reporting agents (INFO)

Domains, lifecycle executor, root-cause executor, CRUD executors: **`metrics_count=0`** — correct. Prevents KPI hallucination on agents that cannot call semantic.

**Do not add metrics[]** to `ticket_lifecycle_executor`, `root_cause_learning_executor`, or Domains.

---

### FE-ONT-004 — Proactive ids stay unregistered (INFO)

` tiaa`, `dssa`, `rcaa`, `icpa`, `tcaa` → **400** on slice HTTP. Ticketing remaps to harness executor ids. **No CL change needed.**

---

## 4. Knowledge graph — ONTOLOGY_CHAT

### FE-KG-001 — No enhancement required (INFO)

| Test | Result (2026-09-17) |
|------|---------------------|
| Why are open tickets elevated this week? | PASS (~1.5k chars) |
| What themes drive SLA breaches? | PASS |

**Not re-tested 2026-09-18** after CL host hang.

**Enhancement:** Optional smoke re-run after SQL/semantic fixes. **Not a database misunderstanding** — narrative graph path separate from semantic numbers and SQL rows.

---

## 5. Cross-cutting enhancements

### FE-X-001 — Publish Ticketing API contract (MEDIUM)

Single OpenAPI or markdown spec covering:

| Endpoint | Document |
|----------|----------|
| `/v1/ontology/slice` | Response: `prompt`, `metrics[]` shape, `dims` |
| `/v1/semantic/query` | `metrics`, `group_by`, `time`, **`filters[].dimension`** |
| `/v1/sql/query` | `instruction`, `entityHint`, `originProduct`, `originAgent`, KPI deny rules |
| ONTOLOGY_CHAT | Query + org scope |

---

### FE-X-002 — Tenant id mapping (MEDIUM)

Tests used integer org/user **1000/1001**. If production uses UUID JWT claims, document mapping or accept UUIDs on CL APIs.

**Not Postgres schema** — identity layer only.

---

### FE-X-003 — Error model consistency (MEDIUM)

Prefer structured errors everywhere:

```json
{
  "detail": {
    "code": "kpi_not_allowed",
    "message": "..."
  }
}
```

Avoid bare 500 strings and 30s hangs without response body.

---

## 6. Post-fix verification script (for CL team)

Run **sequentially** (no concurrency until stable):

```text
1. POST /v1/sql/query  → open tickets list     → 200 + rows[] in <5s
2. POST /v1/sql/query  → "how many open"       → 400 kpi_not_allowed in <1s
3. POST /v1/semantic/query → open_tickets_metric solo → 200 in <5s
4. POST /v1/semantic/query → filter dimension=queue_name → 200 or 422 in <5s
5. POST /v1/semantic/query → time last_30d     → 200 in <5s
6. POST /v1/ontology/slice → ticketing_super_agent → prompt <3000 chars
7. ONTOLOGY_CHAT → one why query               → success
8. Loop all 96 metric ids solo                 → each 200 or fast 4xx
```

---

## 7. Ticketing-side enhancements (our repo — not blocking CL)

For CL awareness; we will implement separately:

| ID | Enhancement | Owner |
|----|-------------|-------|
| TK-SEM-003 | Map filter `field` → `dimension` in `ask_semantic_layer` | Ticketing |
| TK-SEM-002 | Enforce slice metric/dim allowlist before semantic HTTP | Ticketing |
| TK-CAT-001 | Add `ask_sql_layer` to `shared/ticketing_tool_catalog.json` | Ticketing |

---

## Summary priority order for Context Layer

1. **FE-SQL-001** — Fix `schema` kwarg (unblocks all SQL lists)  
2. **FE-SQL-002** — Fail fast; restore KPI deny under load  
3. **FE-SEM-003** — Document filter schema (`dimension`)  
4. **FE-SEM-001** — All 96 metrics respond or fast-fail  
5. **FE-SEM-002** — Capacity / no hang under load  
6. **FE-SEM-004 / FE-SEM-005** — Time presets and group_by  
7. **FE-ONT-001** — Compact Super slice  
8. **FE-X-001** — Published contract doc  

---

*Worktual Ticketing — Context Layer further enhancements — 2026-09-18*
