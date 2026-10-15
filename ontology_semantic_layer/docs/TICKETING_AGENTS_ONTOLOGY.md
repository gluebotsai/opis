# Ticketing agents — ontology purpose and per-agent packs

Every Ticketing **harness** LLM worker gets a **role-scoped ontology block** from Context Layer and injects it into the system prompt.

| Item | Value |
|---|---|
| API | `POST /v1/ontology/slice` |
| Product | `"ticketing"` |
| Agent field | Worker **runtime id** (e.g. `ticket_lifecycle_executor`) — not proactive codes |
| Registry | `ontology/agents.yml` |
| Presets | `ontology/presets/ticketing.yml` |
| Live fetch | `python3 ontology/slice.py -a ticket_lifecycle_executor --tenant org1000` |

**Counts:** 31 harness workers (1 Super + 5 Domains + 25 Executors) each map to **one** `tk.*` preset. Plus compact aliases: `tk.super`, `tk.reporting`, `tk.portal`, `tk.reporting_mas`. **`asga` is not an LLM** — no slice.

**Proactive codes** (`tiaa`, `dssa`, `icpa`, …) are **not registered** for slice. Use the bound harness executor id instead.

---

## 1. What changed

### Before (shared presets)

| Old pattern | Who shared it |
|---|---|
| `tk.tickets` | `ticket_creation_executor`, `ticket_lifecycle_executor` |
| `tk.proactive` | 12+ assist executors **and** all proactive codes |
| `tk.teams`, `tk.kb`, `tk.macros`, `tk.customers`, `tk.admin` | Multiple catalog executors each |
| `tk.reporting` | Both analytics executors + `tiaa` |
| Unprefixed domain keys | e.g. `intake_deflection_domain` preset id matched runtime id |

Problems: over-broad types/actions in prompts, proactive ids could fetch slices directly, Super specialist catalog grouped unrelated workers.

### After (per-agent `tk.*`)

| Change | Detail |
|---|---|
| **31 harness presets** | `tk.<runtime_id>` for every executor; `tk.<domain>` for domains; `tk.super` for Super |
| **Proactive fail-closed** | `tiaa`, `dssa`, `tcaa`, … removed from `ontology/agents.yml` → HTTP 400 on slice |
| **Retired agent mappings** | `tk.tickets`, `tk.proactive`, `tk.teams`, `tk.kb`, `tk.macros`, `tk.customers`, `tk.admin` no longer attached to runtime ids |
| **Reporting split** | `tk.analytics_audit_query_executor` (audit/dashboard/CSAT) vs `tk.insights_analytics_executor` (insights Skill); `tk.reporting` alias → analytics-audit preset |
| **MAS unchanged** | `tk.reporting_mas` kept for KG / MetricFlow / SQL-agent catalog setup |
| **Modules shared** | Still `ticket.yml`, `tk_team.yml`, etc. — only **prompt allowlists + rules** differ per agent |

Canonical hierarchy reference: [ticketing-agents-hierarchy-and-ontology.md](ticketing-agents-hierarchy-and-ontology.md).

---

## 2. Why ontology per agent

| Layer | Ontology job (`prompt` YAML) | `metrics_mode` | Does **not** get in `prompt` |
|---|---|---|---|
| **Super** | Full **product graph** — all entities/relations from `ontology/graph_nodes.yml` for ticketing | `none` | Actions, routing, specialists, KPI metrics |
| **Domain** | Subset of graph entities for that business area | `none` | Actions, routing, metrics |
| **Executor** | Subset of graph entities scoped to that worker’s data domain | `none` (most) | Full 96-metric catalog |
| **Reporting executors** | Analytics entity scope + taxonomy | `headlines` | Ticket row lists (SQL on lifecycle) |
| **Portal** | Customer ticket + KB graph entities | `none` | Org analytics |
| **MAS (`tk.reporting_mas`)** | Full product graph (same as Super data scope) | `full` (metrics on HTTP response, not in YAML) | Routing / actions |

**Compact `prompt` format (all harness workers):** data-only YAML with `entities` (graph label + definition + `schema.table.key` identifier), `relations`, `synonyms`, `taxonomy`, and `business_rules`. No `wt:*` ids, no actions, no route tables. Routing lives in agent `.md` prompts, not the ontology slice.

---

## 3. Runtime id → preset → ontology scope

### L1 — Super

| Runtime id | Preset | Purpose | Key types | Key actions |
|---|---|---|---|---|
| `ticketing_super_agent` | `tk.super` | Route to Domains; never collect slots | All product types (full ontology) | `route_to_specialist`, `spoke_query` |
| `tk.super` | `tk.super` | Compact alias for same pack | Same | Same |

Super `prompt` includes **every ticketing graph node** (e.g. `SupportCase`, `SupportProfile`, `StaffRole`, `SupportQueue`, …) from `ontology/graph_nodes.yml` under `entities`. Use `format: verbose` only for admin/debug (legacy types/actions dump).

### L2 — Domains (planners only)

| Runtime id | Preset | Child executors (delegate) | Types in prompt | Actions |
|---|---|---|---|---|
| `intake_deflection_domain` | `tk.intake_deflection_domain` | `ai_resolution_executor`, `ticket_creation_executor` | Ticket, Customer, Contact, KnowledgeArticle | `route_to_specialist` |
| `triage_routing_domain` | `tk.triage_routing_domain` | classify, assign, workload, routing-learning executors | Ticket, Team, Employee | `route_to_specialist` |
| `resolution_lifecycle_domain` | `tk.resolution_lifecycle_domain` | lifecycle + resolution-side assist executors | Ticket, TicketNote, Team, Employee | `route_to_specialist` |
| `knowledge_domain` | `tk.knowledge_domain` | `resolution_knowledge_executor`, `similar_ticket_detection_executor` | Ticket, KnowledgeArticle | `route_to_specialist` |
| `catalog_administration_domain` | `tk.catalog_administration_domain` | catalog/admin + analytics route executors | Team, KB, Macro, Customer, Ticket, HubRequest | `route_to_specialist` |

Domains never collect slots, never call semantic/SQL, never confirm writes.

### L3 — Executors (workers)

#### Intake & deflection

| Runtime id | Preset | Proactive twin (not registered) | Types | Actions | Must not |
|---|---|---|---|---|---|
| `ai_resolution_executor` | `tk.ai_resolution_executor` | `dssa` | KnowledgeArticle, KbCategory | `get_organization_knowledge`, `navigate` | `create_ticket`, metrics |
| `ticket_creation_executor` | `tk.ticket_creation_executor` | `tcaa` | Customer, Contact, Ticket, TicketDraft | `identify`, `create_ticket`, `enrich_ticket`, `verify_contact_for_ticket` | classify, assign, KPIs |

#### Triage & routing

| Runtime id | Preset | Proactive twin | Types | Actions | Must not |
|---|---|---|---|---|---|
| `classification_priority_executor` | `tk.classification_priority_executor` | `icpa` | Ticket | `enrich_ticket`, `get_ticket_status` | assign people, KPIs |
| `intelligent_assignment_executor` | `tk.intelligent_assignment_executor` | `itra` | Ticket, Team, Employee | `reassign_ticket`, `get_ticket_status` | change priority, KPIs |
| `workload_optimization_executor` | `tk.workload_optimization_executor` | `wloa` | Ticket, Team | `get_ticket_status` | assign, semantic |
| `root_cause_learning_executor` | `tk.root_cause_learning_executor` | `rcaa` | Ticket, Anomaly | `ask_ontology` | `ask_semantic`, ticket mutate |

#### Resolution lifecycle

| Runtime id | Preset | Proactive twin | Types | Actions | Must not |
|---|---|---|---|---|---|
| `ticket_lifecycle_executor` | `tk.ticket_lifecycle_executor` | — | Ticket, TicketNote, SLA, Team | `get_ticket_status`, `reassign_ticket`, `escalate_ticket`, `enrich_ticket` | semantic counts (SQL list-only) |
| `sla_escalation_executor` | `tk.sla_escalation_executor` | `sema` | Ticket, SLA | `escalate_ticket`, `get_ticket_status` | analytics |
| `investigation_summary_executor` | `tk.investigation_summary_executor` | `tsaa` | Ticket, TicketNote | `get_ticket_status` | mutate, KPIs |
| `customer_reply_drafting_executor` | `tk.customer_reply_drafting_executor` | `crda` | Ticket, TicketNote | `get_ticket_status`, `enrich_ticket` | PNA send, KPIs |
| `autonomous_resolution_executor` | `tk.autonomous_resolution_executor` | `ara` | Ticket | `get_ticket_status`, `enrich_ticket` | reassign, analytics |
| `resolution_quality_executor` | `tk.resolution_quality_executor` | `rqa` | Ticket, TicketNote | `get_ticket_status` | CSAT semantic |
| `personalized_notification_executor` | `tk.personalized_notification_executor` | `pna` | Ticket | `get_ticket_status` | inbox CRUD, KPIs |
| `insights_analytics_executor` | `tk.insights_analytics_executor` | `tiaa` | PerformanceReport, Ticket, Anomaly | `ask_semantic`, `ask_ontology`, `generate_report` | list_tickets as counts |

#### Knowledge

| Runtime id | Preset | Proactive twin | Types | Actions | Must not |
|---|---|---|---|---|---|
| `resolution_knowledge_executor` | `tk.resolution_knowledge_executor` | `rkaa` | Ticket, KnowledgeArticle | `get_organization_knowledge`, `get_ticket_status` | KB authoring, semantic |
| `similar_ticket_detection_executor` | `tk.similar_ticket_detection_executor` | `stda` | Ticket, KnowledgeArticle | `get_ticket_status`, `get_organization_knowledge` | create, semantic counts |

#### Catalog & administration

| Runtime id | Preset | Types | Actions | Must not |
|---|---|---|---|---|
| `team_queue_crud_executor` | `tk.team_queue_crud_executor` | Team, Employee | `create_team`, `add_team_members` | tickets, KPIs |
| `kb_quality_crud_executor` | `tk.kb_quality_crud_executor` | KnowledgeArticle, KbCategory | `create_kb_article`, `manage_kb_category`, `get_organization_knowledge` | ticket lifecycle |
| `macro_crud_executor` | `tk.macro_crud_executor` | Macro | `create_macro`, `update_macro`, `delete_macro` | tickets |
| `customer_directory_crud_executor` | `tk.customer_directory_crud_executor` | Customer, Contact | `list_contacts`, `get_contact` | invent 360 |
| `priority_status_crud_executor` | `tk.priority_status_crud_executor` | TicketPriorityDef, TicketStatusDef | `create_priority`, `create_status` | ticket mutate |
| `org_settings_integrations_executor` | `tk.org_settings_integrations_executor` | HubRequest, Organization | `spoke_query` | ticket/analytics tools |
| `notification_inbox_executor` | `tk.notification_inbox_executor` | Ticket | `get_ticket_status` | PNA send, KPIs |
| `analytics_audit_query_executor` | `tk.analytics_audit_query_executor` | Ticket, PerformanceReport, Anomaly | `ask_semantic`, `ask_ontology`, `generate_report` | borrow another agent’s id |
| `automation_rule_crud_executor` | `tk.automation_rule_crud_executor` | TicketPriorityDef | `create_priority` | analytics/ontology tools |

### Compact aliases & platform

| Runtime id | Preset | Purpose |
|---|---|---|
| `tk.reporting` | `tk.analytics_audit_query_executor` | Compact alias for analytics-audit ontology + headlines |
| `tk.portal` | `tk.portal` | Customer portal: own tickets + KB |
| `tk.reporting_mas` | `tk.reporting_mas` | MAS catalog: full ontology + all certified metrics (not staff chat) |

---

## 4. Proactive agents — no ontology slice

Proactive modules (`dssa`, `tcaa`, `icpa`, `itra`, `wloa`, `rcaa`, `tsaa`, `sema`, `crda`, `ara`, `rqa`, `pna`, `tiaa`, `rkaa`, `stda`) run on events/schedules. They propose via ASGA, then execute tools through the **bound harness executor + Skill**.

| Proactive id | Bound harness executor | Use this runtime id for slice |
|---|---|---|
| `dssa` | `ai_resolution_executor` | `ai_resolution_executor` |
| `tcaa` | `ticket_creation_executor` | `ticket_creation_executor` |
| `icpa` | `classification_priority_executor` | `classification_priority_executor` |
| `itra` | `intelligent_assignment_executor` | `intelligent_assignment_executor` |
| `wloa` | `workload_optimization_executor` | `workload_optimization_executor` |
| `rcaa` | `root_cause_learning_executor` | `root_cause_learning_executor` |
| `tsaa` | `investigation_summary_executor` | `investigation_summary_executor` |
| `sema` | `sla_escalation_executor` | `sla_escalation_executor` |
| `crda` | `customer_reply_drafting_executor` | `customer_reply_drafting_executor` |
| `ara` | `autonomous_resolution_executor` | `autonomous_resolution_executor` |
| `rqa` | `resolution_quality_executor` | `resolution_quality_executor` |
| `pna` | `personalized_notification_executor` | `personalized_notification_executor` |
| `tiaa` | `insights_analytics_executor` | `insights_analytics_executor` |
| `rkaa` | `resolution_knowledge_executor` | `resolution_knowledge_executor` |
| `stda` | `similar_ticket_detection_executor` | `similar_ticket_detection_executor` |

Calling `POST /v1/ontology/slice` with a proactive id returns **400 Unknown agent**.

---

## 5. Retired mappings (do not use)

These preset ids are **no longer** attached to harness runtime ids in `ontology/agents.yml`:

| Retired preset | Was shared by | Replaced by |
|---|---|---|
| `tk.tickets` | ticket create + lifecycle executors | `tk.ticket_creation_executor`, `tk.ticket_lifecycle_executor` |
| `tk.proactive` | assist executors + proactive codes | Individual `tk.<executor>` presets |
| `tk.teams` | `team_queue_crud_executor` | `tk.team_queue_crud_executor` |
| `tk.kb` | `kb_quality_crud_executor` | `tk.kb_quality_crud_executor` |
| `tk.macros` | `macro_crud_executor` | `tk.macro_crud_executor` |
| `tk.customers` | `customer_directory_crud_executor` | `tk.customer_directory_crud_executor` |
| `tk.admin` | priority, org settings, inbox, automation executors | Per-executor presets above |

Unprefixed domain preset keys (`intake_deflection_domain` as preset id) renamed to `tk.intake_deflection_domain`, etc.

---

## 6. How to fetch and validate

```bash
# Single worker
python3 ontology/slice.py -a ticket_lifecycle_executor --tenant org1000

# Architecture validation (31 harness + proactive fail-closed)
PYTHONPATH=. python3 scripts/validate_ontology_architecture.py

# Metric / reporting ownership
PYTHONPATH=. python3 scripts/test_metric_ownership.py
```

HTTP example:

```json
POST /v1/ontology/slice
{
  "organizationId": 1000,
  "userId": 1001,
  "product": "ticketing",
  "agent": "ticket_lifecycle_executor",
  "format": "prompt"
}
```

Response `prompt` is appended to that worker’s system prompt. Response `metrics` is empty for this agent (reporting executors get headline subset when `userId` is set).

---

## 7. Related docs

- [TICKETING_CONTEXT_LAYER_INTEGRATION.md](TICKETING_CONTEXT_LAYER_INTEGRATION.md) — slice / semantic / SQL contract (§2 ontology, §6 agent map)
- [ticketing-agents-hierarchy-and-ontology.md](ticketing-agents-hierarchy-and-ontology.md) — MAS hierarchy, Skills, proactive bindings
- [TICKETING_ONTOLOGY_FULL_PROMPT.txt](TICKETING_ONTOLOGY_FULL_PROMPT.txt) — static full legal slice reference (prefer live API)
