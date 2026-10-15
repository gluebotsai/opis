# Ontology-only harness session report

**Date:** 2026-09-20  
**Org / user:** `1012` / `1028` (admin)  
**Context Layer:** `CONTEXT_LAYER_URL=http://192.168.11.25:8765`  
**Slice contract:** `POST /v1/ontology/slice` `product=ticketing` `version=2026.09.3` `industryPack=generic`  
**This report is ontology only.** It does not ask Context Layer to fix semantic `groupBy` / `orderBy` 422s, SQL marts, or chat markdown.

Raw artifacts:

- [ai-agents/logs/ontology-slice-inventory-2026-09-20.json](../ai-agents/logs/ontology-slice-inventory-2026-09-20.json) — all 31 slices
- [ai-agents/logs/ontology-session-matrix-2026-09-20.json](../ai-agents/logs/ontology-session-matrix-2026-09-20.json) — 31 × 10 × 25 utterances
- [ai-agents/logs/ontology-session-static-coverage-2026-09-20.json](../ai-agents/logs/ontology-session-static-coverage-2026-09-20.json) — slice coverage of those utterances
- [ai-agents/logs/ontology-live-sessions-2026-09-20.jsonl](../ai-agents/logs/ontology-live-sessions-2026-09-20.jsonl) — live Super `/agent-turn` (incremental)

Live driver (extended existing owner): `ai-agents/scripts/e2e_strict_all_scenarios.py --ontology-sessions`.

---

## 1. Method

| Step | What ran |
|------|----------|
| Slice inventory | One `POST /v1/ontology/slice` per harness id (31/31 **HTTP 200**) |
| Session matrix | 10 themes × 25 user turns per agent = **310 sessions / 7,750 turns** (fixtures only — not query-path regex) |
| Static coverage | Each turn scored against that agent’s slice **entities / synonyms / metrics[]** |
| Live MAS | Same utterances through Super `POST http://127.0.0.1:8012/agent-turn` (org 1012 / user 1028). **No confirmed writes.** First wave is turn 1 of every session, then turns 2–25. ~20–35s per live turn; full 7,750 live turns is multi-hour. |

Ontology “working” on a turn means:

1. Slice HTTP 200 and non-empty `prompt` (and `metrics[]` on reporting executors).
2. Inject can run (`ontology_slice_prompt_block` — skipped only if `CONTEXT_LAYER_URL` unset).
3. Types / synonyms / metric ids in the slice are enough for that agent’s Skills.
4. The model does not invent metric ids or types that are not in **this** agent’s slice.
5. Super / Domain slices are routing-sized, not a second copy of the full product ontology.

---

## 2. Scoreboard

| Check | Result |
|-------|--------|
| Harness agents with a slice | **31 / 31 HTTP 200** |
| Empty prompt | **0** |
| `metrics[]` on reporting executors | **96** on `analytics_audit_query_executor` and `insights_analytics_executor` |
| `metrics[]` on Super / Domains / other executors | **0** (correct for tool allowlists) |
| Shared Super purpose text on every slice | **31 / 31** — every prompt starts with “Give the Ticketing **super agent** a complete…” |
| `wt:` / `tk.*` type ids in prompt | **0** — slices are YAML `entities:` (`Ticket`, `Staff`, …) not `wt:Ticket` |
| Session fixtures defined | **7,750 / 7,750** |
| Static skill-entity gaps (executor) | See §4 — these are the add-list |
| Live first probe | Super routed “how many open tickets” → `analytics_audit_query_executor`; reply used a real count (not `open_ticket_count`) |

---

## 3. Per-agent slice inventory

Prompt sizes and entity sets from live CL on 2026-09-20. Purpose line is the Super paragraph on **every** agent.

### Super

| Agent | chars | entities | metrics[] | Verdict |
|-------|------:|----------|----------:|---------|
| `ticketing_super_agent` | **11518** | Tenant, Customer, Company, CustomerIdentity, Staff, Queue, Ticket, Note, SLA, KnowledgeArticle, Macro, Notification, AutomationRule, Email, AuditEvent, AssistantSession, WorkflowEvent, Recommendation, Approval, ProactiveDecision, **Product** (21) | 0 | **Over-inject.** Super only routes. 11k types/rules risk Super talking tools/metrics. Compact to Domain names + “do not invent types.” |

### Domains (5)

| Agent | chars | entities | Skill types missing from slice |
|-------|------:|----------|--------------------------------|
| `intake_deflection_domain` | 3611 | Customer, Ticket, KnowledgeArticle | none |
| `triage_routing_domain` | 3374 | Staff, Queue, Ticket | **Priority**, **AuditEvent** |
| `resolution_lifecycle_domain` | 4512 | Customer, Staff, Queue, Ticket, Note, SLA | **AuditEvent**, **KnowledgeArticle**, **Macro**, **Notification** |
| `knowledge_domain` | 3124 | Ticket, KnowledgeArticle | none |
| `catalog_administration_domain` | 5473 | Tenant, Customer, Company, Staff, Queue, Ticket, KnowledgeArticle, Macro | **Priority**, **Status**, **AutomationRule**, **Notification**, **IntegrationWidget**, **IntegrationKey**, **KnowledgeCategory**, **AuditEvent** |

Domains only `delegate_to_executor`. They do **not** need `metrics[]`. They **do** need the child Skill types so they pick the right executor (priority catalog vs ticket classify; automation vs ticket update).

### Executors (25)

| Agent | chars | entities | metrics[] | **Add to this slice** |
|-------|------:|----------|----------:|------------------------|
| `analytics_audit_query_executor` | 4115 | Staff, Queue, Ticket, SLA, AuditEvent | **96** | **Customer** (CSAT / customers_served) |
| `insights_analytics_executor` | 4115 | same as analytics | **96** | none required for current Skill |
| `root_cause_learning_executor` | 3034 | Ticket, AuditEvent | 0 | none (KG-only; no metrics[] is correct) |
| `ticket_lifecycle_executor` | 5256 | Customer, Company, Staff, Queue, Ticket, Note, SLA, Email | 0 | none (SQL/Express rows; empty metrics[] is correct) |
| `ticket_creation_executor` | 4011 | Customer, Company, CustomerIdentity, Ticket | 0 | none |
| `similar_ticket_detection_executor` | 3611 | Customer, Ticket, KnowledgeArticle | 0 | KnowledgeArticle optional; keep or drop consistently |
| `ai_resolution_executor` | 3124 | Ticket, KnowledgeArticle | 0 | **Customer** |
| `autonomous_resolution_executor` | 2398 | Ticket | 0 | **KnowledgeArticle** |
| `classification_priority_executor` | 2466 | Ticket | 0 | **Priority** |
| `intelligent_assignment_executor` | 3205 | Staff, Queue, Ticket | 0 | none |
| `workload_optimization_executor` | 3707 | Staff, Queue, Ticket | 0 | none |
| `investigation_summary_executor` | 3582 | Staff, Ticket, Note | 0 | **AuditEvent** |
| `customer_reply_drafting_executor` | 4069 | Customer, Staff, Ticket, Note | 0 | **Macro** |
| `resolution_knowledge_executor` | 3124 | Ticket, KnowledgeArticle | 0 | none |
| `resolution_quality_executor` | 3020 | Ticket, Note | 0 | none |
| `sla_escalation_executor` | 4056 | Staff, Queue, Ticket, SLA | 0 | none |
| `personalized_notification_executor` | 3592 | Staff, Ticket, Notification | 0 | none |
| `team_queue_crud_executor` | 2755 | Staff, Queue | 0 | none |
| `kb_quality_crud_executor` | 2620 | Staff, KnowledgeArticle | 0 | **KnowledgeCategory** |
| `macro_crud_executor` | 2670 | Staff, Macro | 0 | none |
| `customer_directory_crud_executor` | 3093 | Customer, Company, CustomerIdentity | 0 | none |
| `priority_status_crud_executor` | 2787 | Tenant, Ticket | 0 | **Priority**, **Status** (blocker) |
| `org_settings_integrations_executor` | 2144 | Tenant | 0 | **IntegrationWidget**, **IntegrationKey**, **Staff** |
| `notification_inbox_executor` | 3592 | Staff, Ticket, Notification | 0 | none |
| `automation_rule_crud_executor` | 2999 | Ticket, AutomationRule | 0 | none |

Queue slices still expose numeric-looking **attributes** (`open_tickets`, `assigned_tickets`) that are **not** certified `metrics[]`. Agents can treat those as KPI ids. Rename or mark them as attributes only.

---

## 4. What to add on Context Layer (action list)

These are ontology / slice changes only.

### CL-ONTO-001 — Per-agent purpose (not Super’s paragraph)

**Every** slice `prompt` uses `name: ticketing_complete_ontology` and purpose “Give the Ticketing **super agent** a complete…”. Executors and Domains should get a **short role-specific purpose** (one sentence: this worker’s entities/actions only).

### CL-ONTO-002 — Shrink Super (and Domain) slices

- Super: **11.5k chars / 21 entities** including Product, Approval, ProactiveDecision, AssistantSession. Super never calls MCP business tools.
- Deliverable: routing hint + Domain list. No full attribute trees. No Product unless Super must refuse product questions.

### CL-ONTO-003 — Missing catalog types (highest priority)

| Slice that must gain the type | Add |
|------------------------------|-----|
| `priority_status_crud_executor` | **`Priority`**, **`Status`** as first-class entities (taxonomy on `Ticket` is not enough — this executor authors catalog rows) |
| `org_settings_integrations_executor` | **`IntegrationWidget`**, **`IntegrationKey`**, **`Staff`** (user prefs) |
| `kb_quality_crud_executor` | **`KnowledgeCategory`** |
| `classification_priority_executor` | **`Priority`** |
| `customer_reply_drafting_executor` | **`Macro`** |
| `autonomous_resolution_executor` | **`KnowledgeArticle`** |
| `investigation_summary_executor` | **`AuditEvent`** |
| `ai_resolution_executor` | **`Customer`** |
| `analytics_audit_query_executor` | **`Customer`** (CSAT / accounts) |

### CL-ONTO-004 — Domain slices should list child Skill types

So Domain can delegate “list priorities” to `priority_status_crud_executor` using the word **Priority**, not Ticket fields:

- `catalog_administration_domain`: add Priority, Status, AutomationRule, Notification, IntegrationWidget, IntegrationKey, KnowledgeCategory, AuditEvent
- `triage_routing_domain`: add Priority, AuditEvent
- `resolution_lifecycle_domain`: add AuditEvent, KnowledgeArticle, Macro, Notification

### CL-ONTO-005 — Spoken aliases to add

Present on some slices, missing or weak where chat uses them:

| Spoken | Map to | Where missing |
|--------|--------|----------------|
| agent / assignee | Staff | say so in Staff synonyms (`agent`, `assignee`, `resolver`) on assignment, analytics, lifecycle |
| case / issue | Ticket | already on several; add on Super-compact and priority CRUD |
| team | Queue | already often; keep |
| canned reply | Macro | `macro_crud_executor`, reply-draft |
| help doc / KB | KnowledgeArticle | intake / knowledge |
| API key / widget | IntegrationKey / IntegrationWidget | org settings (types themselves missing) |
| product | Product | only Super has `Product`; either add a refuse rule on Super or add Product nowhere and tell Super “product is not a ticket field unless recorded” |

### CL-ONTO-006 — Reporting `metrics[]` stay on two executors only

Do **not** copy the 96-id `metrics[]` onto Super, Domains, or lifecycle. That would recreate invent-a-metric on the wrong layer.

Optional: add **Customer**-scoped metric names to the analytics slice JSON if CSAT/customers_served are certified (ids already in the 96; entity `Customer` is what is missing).

### CL-ONTO-007 — Do not put KPI names on Queue attributes

`Queue.main_attributes: open_tickets, assigned_tickets, sla_status` look like metric ids. Rename to `open_ticket_ids` / `assigned_count_attr` or document “not ask_semantic_layer ids.”

### CL-ONTO-008 — `industryPack`

Live slices returned `industryPack=generic`. Earlier smokes used `saas_b2b`. Confirm which pack org 1012 should get; wrong pack changes labels/aliases.

---

## 5. Session findings (10 × 25 per agent)

Themes are in the matrix JSON (Super: route/continue/refuse/alias; Domain: two Skills / park; Executor: list vs create, missing type, no write).

Static coverage of all **7,750** turns: many “gaps” on follow-up lines that mention *note* / *product* / *staff* on purpose (probe). **Ignore those.** Skill-level misses in §4 are the real add-list.

Live MAS (2026-09-20, `POST /agent-turn`, 33 turns logged, all HTTP 200, **0 invented `*_metric` / `*_count` strings** in replies):

| Target (session 1 / turn 1) | Super actually landed | Ontology note |
|-----------------------------|----------------------|---------------|
| All 5 Domains | Correct child executor | Slice enough to delegate |
| 22 / 25 Executors | Same executor | Pin OK |
| `analytics_audit_query_executor` | **`general`** (93s) | Reporting slice not used; Super missed catalog Domain |
| `insights_analytics_executor` | `analytics_audit_query_executor` | Sibling reporting worker — 96 metrics still apply |
| `personalized_notification_executor` | `ai_resolution_executor` | Notification type in slice did not keep Super on catalog/resolution notify |
| `sla_escalation_executor` | `ticket_lifecycle_executor` | SLA entity exists on both; Super treated it as ticket search |
| `ticketing_super_agent` (file ticket) | `ticket_creation_executor` | Correct route |

Separate earlier probe: “how many open tickets” → `analytics_audit_query_executor` with a real count (not `open_ticket_count`).

Remaining 7,717 matrix turns: `cd ai-agents && PYTHONPATH=. .venv/bin/python -u scripts/e2e_strict_all_scenarios.py --ontology-sessions` (resumes JSONL). ~20–35s each; do not run concurrent.

---

## 6. What we will **not** ask CL to add (out of scope here)

- Semantic request fields `groupBy` / `orderBy` (query schema, not slice types)
- SQL `/v1/sql/query` marts or `schema` kwarg
- Knowledge-graph SSE narrative quality
- Ticketing Skill/prompt edits (unless a missing **type** in the slice is confirmed)

---

## 7. Verify notes

- `CONTEXT_LAYER_URL` must stay in root `.env` **and** `ai-agents/.env` or inject is skipped and the executor invents ids (`open_ticket_count`).
- Restart MCP (8020) + agents (8012) after env changes (`get_settings` is cached).
- Cookie login via `/api/auth/login` was not used for this run; live sessions used the same `/agent-turn` envelope Express uses, with org/user 1012/1028.