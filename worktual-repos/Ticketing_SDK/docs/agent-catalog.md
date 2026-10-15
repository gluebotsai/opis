# Ticketing agent catalog

Brief inventory of **every agent that exists today** (September 2026) and the **tasks / Skills** each one owns.

Staff chat is **Super → Domain → Executor**. Proactive agents run on events/timers and bind to the same Domain + Executor + Skill. They do **not** replace each other.

Writes always go **Executor / proactive → MCP / Express → Postgres**. Agents never write the database directly.

Prompt source of truth: `ai-agents/app/agents/definitions/<id>/agent.md`.

---

## How the layers work

| Layer | Count | Job |
|---|---|---|
| **Super** | 1 | CONTINUE / NEW_TASK / SIDE_QUEST / CANCEL / RESUME. Routes to one Domain. Never collects slots or confirms writes. |
| **Domain** | 5 | One bounded plan: `delegate_to_executor` with Executor + Skill + task. |
| **Executor** | 25 | Selected Skill, collect fields, semantic confirm, MCP tools, grounded reply. |
| **Proactive** | 15 + ASGA gate | Event/timer proposals. Same Skills as the matching Executor. |

```text
User / Hub utterance
  → Super (route or continue)
    → Domain (pick Executor + Skill)
      → Executor (tools + confirm)
        → Express RBAC / mutations
          → Postgres
```

---

## Super

### `ticketing_super_agent`

**Description.** Conversation router for staff coworker (and Hub via the same MAS). Reads meaning, not keywords.

**Tasks.** `route_to_domain`, `continue_active_task`, `resume_task`, `refuse_capability`. Classifies continue vs new Skill vs park vs cancel.

**Does not.** Collect ticket/catalog fields, confirm writes, invent ids, answer list rows, or call mutate tools.

**Routes to**

| Domain | Typical work |
|---|---|
| `intake_deflection_domain` | New ticket, customer verify for create, intake how-to / KB search |
| `triage_routing_domain` | Classify/prioritize, best assignee, workload, routing learning |
| `resolution_lifecycle_domain` | List/open ticket, update, note, reassign, escalate, resolve/reopen, SLA, summary, reply draft |
| `knowledge_domain` | Recommend KB for a ticket, similar-ticket detect |
| `catalog_administration_domain` | Teams, macros, KB authoring, priorities/statuses, customer **list/360 only**, org prefs, integrations, inbox, analytics, automation rules |

---

## Domains

### `intake_deflection_domain`

**Description.** Plans new-issue intake: file a ticket, or deflect with self-service / KB.

**Delegates**

- `ticket_creation_executor` — `ticket-create`, `customer-verify`, `ticket-enrich`
- `ai_resolution_executor` — `intake-self-service-deflection`, `knowledge-search`

**Does not.** Collect create-ticket slots itself. Close/reopen of an existing ticket is parked back to Super → resolution Domain.

### `triage_routing_domain`

**Description.** Plans classify → assign after create, plus scheduled load and routing-learning work.

**Delegates**

- `classification_priority_executor` — `ticket-classify-prioritize`
- `intelligent_assignment_executor` — `ticket-assign-best`
- `workload_optimization_executor` — `routing-optimize-workload`
- `root_cause_learning_executor` — `routing-learn-from-outcomes`

Post-insert lean path (no Super): classify/enrich first, then assign L1/L2.

### `resolution_lifecycle_domain`

**Description.** Plans work on tickets that already exist, plus resolution-side assist Skills.

**Delegates**

- `ticket_lifecycle_executor` — list/search, update, note, reassign, escalate, resolve/reopen
- `sla_escalation_executor` — SLA monitor / escalate
- `investigation_summary_executor` — rolling investigation summary
- `customer_reply_drafting_executor` — customer reply draft
- `autonomous_resolution_executor` — close/reopen from customer “it’s fixed / broken”
- `resolution_quality_executor` — quality check on resolved tickets
- `personalized_notification_executor` — staff bell personalization
- `insights_analytics_executor` — narrative insights (not KPI counts)

### `knowledge_domain`

**Description.** Plans assist-only knowledge work on a live ticket (not KB authoring).

**Delegates**

- `resolution_knowledge_executor` — `knowledge-recommend-resolution`
- `similar_ticket_detection_executor` — `ticket-detect-similar`

KB create/update/publish lives on `catalog_administration_domain`.

### `catalog_administration_domain`

**Description.** Plans org catalog and admin surfaces: teams, macros, KB articles, priorities/statuses, customer lookup, prefs, widgets/keys, inbox, analytics, automation.

**Delegates** (by Executor): team, KB, macro, customer-read, priority/status, org/integrations, notifications, analytics/audit, automation-rule Executors.

**Does not.** File tickets, reassign/escalate, or add/edit customer contact records in chat (Super refuses create/import).

---

## Executors (chat + shared Skills)

Each Executor runs **one selected Skill** per turn: collect schema fields, confirm writes, call only authorized tools, quote TOOL RESULT only.

### Intake

| Agent | Brief description | Tasks / Skills |
|---|---|---|
| `ticket_creation_executor` | Files a new staff or portal ticket. Collects name → contact → verify → issue; duplicate-checks same customer; never invents customers. | `ticket-create`, `customer-verify`, `ticket-enrich` |
| `ai_resolution_executor` | Answers how-to / self-service from KB so a ticket may not be needed. | `intake-self-service-deflection`, `knowledge-search` |

### Triage / routing

| Agent | Brief description | Tasks / Skills |
|---|---|---|
| `classification_priority_executor` | Sets subject, description, priority, category, queue from the issue (ICPA). | `ticket-classify-prioritize` |
| `intelligent_assignment_executor` | Picks L1 agent and L2 resolver from live roster + workload (ITRA). Does not invent names. | `ticket-assign-best` |
| `workload_optimization_executor` | Writes an org load brief for ITRA. Does **not** assign people. | `routing-optimize-workload` |
| `root_cause_learning_executor` | Learns routing patterns from outcomes into weights (silent). | `routing-learn-from-outcomes` |

### Ticket lifecycle

| Agent | Brief description | Tasks / Skills |
|---|---|---|
| `ticket_lifecycle_executor` | Browse/search/page tickets; update fields; add notes; reassign; escalate; resolve or reopen. Not KPI counts. | `ticket-read-search`, `ticket-update`, `ticket-note-add`, `ticket-reassign`, `ticket-escalate`, `ticket-resolve-reopen` |
| `investigation_summary_executor` | Keeps a rolling AI investigation summary on the ticket (TSAA). | `ticket-investigation-summary` |
| `sla_escalation_executor` | Warns on SLA risk; escalate only through tools + confirm (SEMA). | `sla-monitor-escalate` |
| `customer_reply_drafting_executor` | Drafts a customer reply. Does not auto-send (CRDA). | `reply-draft` |
| `autonomous_resolution_executor` | Closes or reopens when the customer says the issue is fixed or back (ARA). | `ticket-autonomous-resolution` |
| `resolution_quality_executor` | Checks resolved tickets for a real close-out note (RQA). | `ticket-resolution-quality` |
| `personalized_notification_executor` | Delivers staff bell pings from prefs (PNA). | `notification-personalize-deliver` |
| `insights_analytics_executor` | Narrative “why / drivers” insights for tickets (TIAA). | `analytics-generate-insights` |

### Knowledge assist

| Agent | Brief description | Tasks / Skills |
|---|---|---|
| `resolution_knowledge_executor` | Recommends KB / past resolution material for the open ticket (RKAA). | `knowledge-recommend-resolution` |
| `similar_ticket_detection_executor` | Flags similar / duplicate tickets (STDA). | `ticket-detect-similar` |

### Catalog / admin

| Agent | Brief description | Tasks / Skills |
|---|---|---|
| `team_queue_crud_executor` | List/create/update/delete teams (queues) and add/remove members. | `team-read`, `team-create`, `team-update`, `team-members-update`, `team-delete` |
| `kb_quality_crud_executor` | List, create, update, publish, import/export KB; manage categories. | `knowledge-read`, `knowledge-article-create`, `knowledge-article-update`, `knowledge-article-publish`, `knowledge-category-manage`, `knowledge-import`, `knowledge-export` |
| `macro_crud_executor` | List/create/update/delete macros. | `macro-read`, `macro-create`, `macro-update`, `macro-delete` |
| `customer_directory_crud_executor` | Search customers and ticket history (360). Create/import Skills exist on the executor but chat Super **refuses** add/edit of contact records. | `customer-read-360`, `customer-create`, `customer-import` |
| `priority_status_crud_executor` | CRUD for priority and status catalog rows (label, SLA hours). | `priority-*`, `status-*` (read/create/update/delete) |
| `org_settings_integrations_executor` | Org/user prefs, widgets, API keys, Hub delegate, long-term memory. | `org-preferences-*`, `user-preferences`, `long-term-memory`, `integration-widget-*`, `integration-key-*`, `hub-delegate` |
| `notification_inbox_executor` | Read staff inbox, mark read, clear. | `notification-inbox-read`, `notification-mark-read`, `notification-clear` |
| `analytics_audit_query_executor` | Dashboard snapshot, NL metric queries, CSAT, export, audit, escalation directory. | `dashboard-metrics-read`, `analytics-query`, `analytics-export`, `analytics-root-cause`, `csat-report`, `audit-query`, `escalation-directory-read` |
| `automation_rule_crud_executor` | Read/create/update/delete automation rules. | `automation-rule-read`, `automation-rule-create`, `automation-rule-update`, `automation-rule-delete` |

---

## Proactive agents (events / timers)

These are **not** in the chat Super loop unless a task explicitly says so. Each has a Harness binding to a Domain + Executor + Skill. **ASGA** (not an agent) gates: run now / Approvals Confirm / recommend / reject.

| Code | Full name | Usual mode | Brief description | Bound Executor / Skill |
|---|---|---|---|---|
| **TCAA** | Ticket Creation & Capture | Semi-active | Turns inbound mail/chat/widget into a ticket proposal. | `ticket_creation_executor` / `ticket-create` |
| **DSSA** | Deflection & Self-Service | Autonomous / recommend | Answers simple how-tos from KB; skip ticket if confident. | `ai_resolution_executor` / `intake-self-service-deflection` |
| **ICPA** | Classification & Prioritization | Recommend / semi-active | Category and priority on new tickets. | `classification_priority_executor` / `ticket-classify-prioritize` |
| **ITRA** | Intelligent Routing | Semi-active / recommend | Who / which queue should own the ticket. | `intelligent_assignment_executor` / `ticket-assign-best` |
| **WLOA** | Workload Optimization | Recommend | Load-balancing advice; does not reassign. | `workload_optimization_executor` / `routing-optimize-workload` |
| **RCAA** | Root Cause & Learning | Autonomous | Learns recurring patterns into routing weights. | `root_cause_learning_executor` / `routing-learn-from-outcomes` |
| **TSAA** | Ticket Summary Assistant | Autonomous | Rolling AI summary on the ticket. | `investigation_summary_executor` / `ticket-investigation-summary` |
| **SEMA** | SLA & Escalation | Recommend / semi-active | SLA risk; escalate after Confirm. | `sla_escalation_executor` / `sla-monitor-escalate` |
| **CRDA** | Customer Response Drafting | Semi-active | Draft customer reply; never auto-send. | `customer_reply_drafting_executor` / `reply-draft` |
| **ARA** | Autonomous Resolution | Semi-active | Close/reopen from customer “fixed / broken”. | `autonomous_resolution_executor` / `ticket-autonomous-resolution` |
| **RQA** | Resolution Quality | Semi-active / recommend | Check Resolved tickets for a real close-out. | `resolution_quality_executor` / `ticket-resolution-quality` |
| **PNA** | Personalized Notifications | Autonomous | Staff bell when prefs allow (not Approvals). | `personalized_notification_executor` / `notification-personalize-deliver` |
| **TIAA** | Insights & Analytics | Recommend | Org insights from real data / semantic layer. | `insights_analytics_executor` / `analytics-generate-insights` |
| **RKAA** | Resolution Knowledge | Recommend | Point staff at useful KB / past tickets. | `resolution_knowledge_executor` / `knowledge-recommend-resolution` |
| **STDA** | Similar Ticket Detection | Recommend | Flag duplicates and past solutions. | `similar_ticket_detection_executor` / `ticket-detect-similar` |

**ASGA** — safety gate after every proactive proposal (autonomous / Confirm / recommend / reject). Not a chat agent.

---

## Count

| Kind | Agents |
|---|---|
| Super | 1 |
| Domain | 5 |
| Executor | 25 |
| Proactive (named) | 15 |
| **Total named agents** | **46** (plus ASGA gate) |

---

## Related docs

- [agents-working-guide.md](./agents-working-guide.md) — proactive modes in plain language
- [proactive-agents.md](./proactive-agents.md) — Approvals behaviour
- [agents-ticket-lifecycle.md](./agents-ticket-lifecycle.md) — create → resolve
- [mas-agents-guide.md](./mas-agents-guide.md) — older long-form guide (some chat sections predate Super → Domain → Executor)
