# Ticketing MAS + Context Layer — check-only audit report

**Generated:** 2026-09-16 (local)  
**Rule:** Read-only audit — **no product code, config, tests, or plan file edits** were made during this run.

---

## 1. Executive verdict

| Area | Verdict | Owner |
|---|---|---|
| Ticketing wiring (slice inject, semantic `metrics[]`, KG rename, Express writes) | **MOSTLY READY** | Ticketing |
| Context Layer API (slice content, semantic truth, SQL marts) | **NOT READY** | Context Layer |
| Live MAS behavior (from existing turn logs) | **PARTIAL** — routing OK; tools still drift on KPI | Runtime / LLM + stale logs |
| Existing pytest regression | **MIXED** — integration tests pass; unrelated suites fail | Tests / legacy paths |

**Overall: NOT READY** for production KPI answers until Context Layer semantic truth is fixed and live chat re-verified after deploy with `CONTEXT_LAYER_URL`.

---

## 2. Environment snapshot (read-only)

| Variable | Source | Notes |
|---|---|---|
| `CONTEXT_LAYER_URL` | Verify script default | `http://192.168.11.25:8765` (used for live probe) |
| `ONTOLOGY_CHAT_URL` | Verify script default | `http://82.113.92.44:8000/chat/stream` — KG SSE **PASS** |
| `SEMANTIC_LAYER_URL` | `.env.example` only | Legacy `/ask` path; not exercised in live probe |
| Postgres | repo `.env` via verify script | Orgs **1000** (primary), **1003**, **1001** empty, **999999** invalid |

Service health: **200**, ticketing warm, version **1.2.0**. All **46** runtime ids registered on Context Layer.

---

## 3. Phase 1 — Pytest regression (existing tests only)

| Suite | Command filter | Result |
|---|---|---|
| Context layer / proactive | `test_proactive_agents.py -k "semantic or ontology or knowledge_graph or slice or tiaa or rcaa"` | **14 passed** |
| Tool loop / analytics | `test_tool_loop.py -k "semantic or ontology or knowledge_graph or analytics_query or remount or lean"` | **7 passed** |
| Lean / turn log / workflow | `test_lean_chat.py test_turn_log.py test_layer1_workflow_manager.py -k "semantic or analytics or metrics or route"` | **30 passed, 12 failed** |
| RBAC / A2A | `test_rbac_early_refuse.py test_a2a_spoke.py` | **78 passed** |

**Integration-related tests: all pass (21/21).**

Failures in suite 3 are **not Context Layer regressions** (record only, do not fix in this audit):

- `test_lean_chat.py::test_ticket_question_routes_to_tickets` — `dispatch_tool` no longer on `ticketing_coworker` (stale test vs harness).
- `test_layer1_workflow_manager.py::TestCreateTicketSemantic` (11 tests) — portal create-ticket draft `awaiting` expectations (`confirm` vs `issue`).

**Finding:** No pytest assertion still requires `ask_ontology`; KG rename tests pass.

---

## 4. Phase 2 — Live Context Layer + Postgres

**Script:** `/Users/apple/Downloads/run_context_layer_verify.py`  
**Output:** `/Users/apple/Downloads/ticketing-context-layer-verify.md` + `.json`  
**Result:** **74 / 99 checks passed** (25 failed)

### 4.1 Ontology slice (46 runtime ids × fixtures)

**Org 1000 / user 1005 (entitled):**

| Agent class | HTTP | metrics[] | Pass criteria | Result |
|---|---|---|---|---|
| `ticketing_super_agent` | 200 | 0 | No `create_ticket` in prompt | **FAIL** (prompt still contains write verbs) |
| 5 Domains | 200 | 0 | metrics empty | **PASS** |
| Lifecycle / catalog / proactive twins | 200 | 0 | metrics empty | **PASS** |
| `analytics_audit_query_executor` | 200 | **95** | headline metrics present | **PASS** |
| `insights_analytics_executor` | 200 | **95** | same | **PASS** |
| `tiaa` | 200 | **95** | same | **PASS** |

**Org 1003 / 1001:** slice **HTTP 400** for most agents (not entitled) — expected for wrong SKU; not a Ticketing wiring bug.

**Org 999999:** slice **HTTP 403** — **PASS** (invalid tenant guard).

**Ticketing wiring note:** Per-runtime `agent` id is accepted (200 on org 1000). Reporting workers receive full metric catalog in slice — supports `metrics[]` semantic calls.

### 4.2 Semantic vs Postgres (org 1000)

| Metric | Postgres (catalog) | Semantic | Pass |
|---|---|---|---|
| `open_tickets_metric` | 99 | **0** | FAIL |
| `high_priority_open_tickets_metric` | 70 | **HTTP 400** | FAIL |
| `unassigned_tickets_metric` | 2 | **0** | FAIL |
| `tickets_created_today_metric` | 2 | 2 | PASS |
| `current_overdue_tickets_metric` | 97 | 93 | FAIL |
| `due_today_tickets_metric` | 5 | 5 | PASS |
| `ticket_volume` | 109 | 1 | FAIL |
| `average_csat_score` (admin) | 4.33 | None | FAIL |
| `average_csat_score` (agent) | 4.33 | 4.33 | PASS |

**Owner: Context Layer** — certified numbers wrong or 400 for several headline metrics.

### 4.3 Semantic entitlement negatives

| Test | Result |
|---|---|
| Super semantic | 400 PASS |
| Lifecycle semantic | 400 PASS |
| Wrong product | 400 PASS |
| Empty metrics | 422 PASS |
| RCAA semantic | 400 PASS |
| Extra NL `query` field on semantic body | **FAIL** (200 accepted — contract drift) |

### 4.4 SQL Super

| Test | Result |
|---|---|
| Ticket list (`mart_tickets`) | 200, **0 rows** — mart empty |
| Notes | 200, 1 row PASS |
| Audit | **HTTP 500** (343 audit rows in Postgres) FAIL |
| KPI phrase on lifecycle SQL | **FAIL** (200 instead of 400) |

Ticketing correctly keeps **Express `list_tickets`** as primary list path; SQL issues are Context Layer-side.

### 4.5 Knowledge graph

KG SSE **PASS** for org 1000 and 1003 (events received).

---

## 5. Phase 3 — Static Ticketing wiring (read-only)

### 5.1 Improvements confirmed

| Check | Status |
|---|---|
| `get_ontology_slice()` internal only — **not** in [ticketing_tool_catalog.json](shared/ticketing_tool_catalog.json) | PASS |
| Slice injected per runtime id in [ticketing_coworker.py](ai-agents/app/agents/ticketing_coworker.py) (Super pin ×2, route Super, Domain, Executor) | PASS (5 call sites) |
| Proactive LLM slice in [llm_json.py](ai-agents/app/proactive/llm_json.py) | PASS |
| `ask_semantic_layer` schema uses `metrics[]` in shared catalog | PASS |
| `ask_ontology` → `ask_knowledge_graph` in registry, bound tools, catalog | PASS |
| Super prompt remounts how-many → `catalog_administration_domain` + `ask_semantic_layer` | PASS |
| Frozen MAS: 1 Super + 5 Domains + 25 Executors | PASS |
| [rcaa.py](ai-agents/app/proactive/rcaa.py) runtime: no `ask_semantic_layer` call | PASS |
| [tiaa.py](ai-agents/app/proactive/tiaa.py) uses structured `metrics[]` + `agent="tiaa"` | PASS (code review) |
| Express writes unchanged; no Context Layer mutation tools | PASS |

### 5.2 Drawbacks / gaps (static)

| Issue | Severity | Owner |
|---|---|---|
| [registry.py](ai-agents/app/tools/registry.py) `rcaa` allowlist still includes `ask_semantic_layer` | Low | Ticketing (allowlist drift; CL correctly 400) |
| [e2e_strict_all_scenarios.py](ai-agents/scripts/e2e_strict_all_scenarios.py) `CHAT_MODULE_PARITY` expects `get_metrics` / `get_analytics` for KPI phrases | Medium | Stale e2e expectations |
| `.env.example` documents `SEMANTIC_LAYER_URL` but not `CONTEXT_LAYER_URL` | Low | Docs/env example only |

---

## 6. Phase 4 — Agent turn log audit (existing logs only)

**Sources:** `ai-agents/logs/agent-turn-2026-09-{12..16}.log` (last 7 days)  
**No new chat turns were driven.**

| Metric | Value |
|---|---|
| Total turns parsed | 1,607 |
| Turns with ROUTE or TOOL lines | 57 |
| Tool calls (top) | `route_to_domain` 23, `delegate_to_executor` 23, `patch_ticket_draft` 20, `list_tickets` 7, `ask_semantic_layer` 2, **`ask_ontology` 1** |

### 6.1 Routing samples (instrumented turns)

| Query (truncated) | Route chain | Tools | Contract |
|---|---|---|---|
| CLV data integrity / org 1003 | Super → catalog → `analytics_audit_query_executor` | `ask_ontology`, `ask_semantic_layer` | Route OK; **legacy tool name** in log (pre-rename traffic) |
| Look up customer fazil | Super → catalog → `customer_directory_crud_executor` | `list_customers` | PASS |
| September 1 reports | Super → catalog → `analytics_audit_query_executor` | (no tool logged) | Route OK |
| Today's reports | Super → catalog → `analytics_audit_query_executor` | **`get_metrics`** | **FAIL** — should use `ask_semantic_layer` + `metrics[]` |
| Hub list open tickets | resolution → `ticket_lifecycle_executor` | `list_tickets` | PASS (list not semantic) |

### 6.2 Log audit limitations

- **1,550 turns** have no ROUTE/TOOL instrumentation (greetings, errors, or logging gap) — cannot score routing.
- Logs span **pre-integration** traffic (`ask_ontology` still appears once).
- Cannot verify **slice.prompt injection** from logs alone (not logged); only static code + CL slice API confirm wiring.

**Phase 4 verdict:** **PARTIAL** — Super→Domain→Executor routing looks correct on sampled KPI/list flows; at least one KPI turn used `get_metrics` instead of semantic; logs not sufficient to prove post-deploy `metrics[]` behavior.

---

## 7. Improvement vs drawback matrix

### Improvements (integration goals met in code)

1. Per-runtime ontology slice fetch + cache (`get_ontology_slice`).
2. Semantic path uses structured `metrics[]` + `organizationId` + `userId` + runtime `agent` when `CONTEXT_LAYER_URL` set.
3. KG renamed to `ask_knowledge_graph` across registry/catalog/tests.
4. Slice injected at Super, Domain, Executor, and proactive LLM layers.
5. RCAA proactive path stopped calling semantic (runtime code).
6. 503 SQL `metricRequest` fallback implemented (not exercised — semantic returned 200 with wrong values).

### Drawbacks (no fixes applied)

1. **Context Layer semantic truth** — open/unassigned/high-priority/volume wrong vs Postgres.
2. **Super slice prompt** still contains `create_ticket` (CL YAML).
3. **Org 1003** not entitled to ticketing slice (400).
4. **SQL marts** empty; audit SQL 500.
5. **Live logs** show `get_metrics` for KPI and legacy `ask_ontology` (historical).
6. **Pytest** lean_chat + workflow_manager create-ticket failures (unrelated suites).
7. **E2e script** still expects old KPI tools.
8. **RCAA allowlist** still lists semantic (executor harness could call it if LLM chooses).

---

## 8. Recommendations (report only — do not implement here)

1. **Context Layer team:** Fix semantic formulas, `high_priority` 400, Super slice content, SQL marts, audit SQL, reject NL `query` on semantic.
2. **After CL fix:** Re-run `python3 ~/Downloads/run_context_layer_verify.py` until **99/99** (or agreed subset).
3. **Ticketing ops:** Set `CONTEXT_LAYER_URL` in deployed agents env; restart to load slice cache.
4. **Re-verify live chat:** Drive a small KPI matrix (how-many, why, list, create) and confirm turn logs show `ask_semantic_layer` with `metrics[]` and no `get_metrics` for NL KPI.
5. **Follow-up (separate change):** Update e2e parity expectations and RCAA allowlist when edits are allowed.

---

## 9. Artifacts

| File | Purpose |
|---|---|
| This report | `/Users/apple/Downloads/ticketing-mas-context-layer-check-report.md` |
| CL verify (latest run) | `/Users/apple/Downloads/ticketing-context-layer-verify.md` |
| CL verify JSON | `/Users/apple/Downloads/ticketing-context-layer-verify.json` |
| Prior integration notes | `/Users/apple/Downloads/ticketing-context-layer-integration-report.md` |
| Turn logs analyzed | `ai-agents/logs/agent-turn-2026-09-*.log` |

---

## 10. Sign-off

| Layer | READY? |
|---|---|
| Ticketing code wiring | **Yes** (with minor allowlist/e2e drift) |
| Context Layer service | **No** |
| End-to-end KPI answers | **No** |
| List/create/write flows (Express) | **Yes** (logs + architecture; not re-driven live) |

**Check-only audit complete. No repository files were modified.**
