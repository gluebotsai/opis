# Context Layer smoke test report (CL issues only)

**Date:** 2026-09-18  
**Duration:** ~55 seconds (focused smoke — not full 96-metric matrix)  
**Tenant:** `organizationId=1000`, `userId=1001`  
**Context Layer:** `http://192.168.11.25:8765`  
**Knowledge graph:** `http://82.113.92.44:8000`

**Scope:** Context Layer server behavior only. Ticketing client wiring excluded.

---

## Summary

| Surface | Smoke result | CL issues |
|---------|:------------:|:---------:|
| Health | **PASS** | 0 |
| Ontology slice | **PASS** (with 1 content issue) | 1 |
| Semantic layer | **PASS** | 0 |
| SQL agent | **PARTIAL** | 3 |
| Knowledge graph | **PASS** | 0 |

**Overall:** **18 checks passed**, **4 Context Layer issues** found.

---

## What is working (Context Layer)

### Health
- `GET /health` → **200**

### Ontology slice (`POST /v1/ontology/slice`)
- `analytics_audit_query_executor` → **200**, **96** certified metrics in `metrics[]`
- `ticket_lifecycle_executor` → **200**, `metrics_count=0` (correct — no KPI catalog on lifecycle)
- Proactive `tiaa` → **400** (correct — not a registered slice agent)

### Semantic layer (`POST /v1/semantic/query`)
All headline KPIs returned **200** in this smoke run:

| Metric | Result |
|--------|:------:|
| `open_tickets_metric` | 200 |
| `average_csat_score` | 200 |
| `ticket_volume` | 200 |
| `breached_tickets_metric` | 200 |
| `active_tickets_metric` | 200 |

Also **200**:
- `group_by: [queue_name]` on `open_tickets_metric`
- `time.preset: last_30d`
- Filter `{ dimension: queue_name, op: eq, value: Billing }` + `last_30d`

Policy **200/400 as expected**:
- `ticket_lifecycle_executor` on semantic → **400** (not entitled)

### Knowledge graph (ONTOLOGY_CHAT)
- Why query → **PASS** (~1,023 chars)
- What query → **PASS** (~1,034 chars)

---

## Context Layer issues (action required)

### 1. CL-SLICE-SUPER-SIZE — Super slice too large (MEDIUM)

| | |
|--|--|
| **Surface** | Ontology slice |
| **Endpoint** | `POST /v1/ontology/slice` `agent=ticketing_super_agent` |
| **What happened** | HTTP 200 but `prompt_len=11,124` characters, `metrics_count=0` |
| **Why it matters** | Super only routes chat; it never calls semantic/SQL/KG. Large ontology text wastes tokens and can push the model toward data answers it cannot tool. |
| **Not a DB issue** | Content/design on CL ontology YAML |
| **Fix** | Compact Super slice to routing hints only (~&lt;3k chars). Do **not** add `metrics[]` to Super. |

---

### 2. CL-SQL-EMPTY — List query returns no rows (MEDIUM)

| | |
|--|--|
| **Surface** | SQL agent |
| **Endpoint** | `POST /v1/sql/query` |
| **Instruction** | `List open tickets assigned to the current user` |
| **What happened** | HTTP **200** but `rows=[]` |
| **Why it matters** | SQL path is reachable but marts may be empty or not scoped to org 1000 — agents get an empty list with no error signal. |
| **Likely cause** | **Mart / tenant data** on CL side (Postgres mart sync or org filter), not Ticketing sending wrong SQL |
| **Fix** | Confirm ticketing marts populated for org 1000; return explicit `no_data` code when empty if intentional |

---

### 3. CL-SQL-notes — Notes preset fails (HIGH)

| | |
|--|--|
| **Surface** | SQL agent |
| **Endpoint** | `POST /v1/sql/query` |
| **Instruction** | `Show notes for ticket 115` |
| **What happened** | HTTP **500**: `SQL agent failed. Check server logs.` |
| **Why it matters** | Ticket detail / notes browsing via SQL Super broken for this shape |
| **Likely cause** | **CL SQL agent** query generation or mart join — not Ticketing (NL instruction only) |
| **Fix** | Check CL `sql_agent/` logs for ticket 115 notes path |

---

### 4. CL-SQL-similar — Similar-ticket query fails (HIGH)

| | |
|--|--|
| **Surface** | SQL agent |
| **Endpoint** | `POST /v1/sql/query` |
| **Instruction** | `Find tickets similar to ticket 115` |
| **Origin agent** | `similar_ticket_detection_executor` |
| **What happened** | HTTP **500**: `SQL agent failed. Check server logs.` |
| **Why it matters** | Similar-ticket list path broken |
| **Fix** | Same as CL-SQL-notes — SQL Super / mart coverage |

---

## SQL checks that passed (Context Layer)

| Check | Result |
|-------|--------|
| List open tickets (HTTP) | 200 (empty rows — see CL-SQL-EMPTY) |
| KPI deny `"how many open tickets"` | **400** `kpi_not_allowed` |

---

## Not tested in this smoke (known from full matrix 2026-09-18)

These may still fail under **heavy concurrent load** even when smoke passes:

- All **96** metrics × all dims × filters (921 timeouts in full matrix)
- Filter body using `field` instead of `dimension` (Ticketing-side; CL expects `dimension`)
- SQL after semantic saturation (30s hangs observed previously)

Re-run full matrix after CL fixes SQL 500s and capacity.

---

## Quick re-test commands (CL team)

```bash
# Health
curl -s http://192.168.11.25:8765/health

# Slice
curl -s -X POST http://192.168.11.25:8765/v1/ontology/slice \
  -H 'Content-Type: application/json' \
  -d '{"organizationId":1000,"userId":1001,"product":"ticketing","agent":"analytics_audit_query_executor"}'

# Semantic
curl -s -X POST http://192.168.11.25:8765/v1/semantic/query \
  -H 'Content-Type: application/json' \
  -d '{"organizationId":1000,"userId":1001,"product":"ticketing","agent":"analytics_audit_query_executor","metrics":["open_tickets_metric"]}'

# SQL list
curl -s -X POST http://192.168.11.25:8765/v1/sql/query \
  -H 'Content-Type: application/json' \
  -d '{"organizationId":1000,"userId":1001,"originProduct":"ticketing","originAgent":"ticket_lifecycle_executor","instruction":"List open tickets assigned to the current user","entityHint":"wt:Ticket"}'
```

---

*Generated from Worktual Ticketing fast smoke test — Context Layer issues only.*
