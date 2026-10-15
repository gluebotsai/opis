# Ticketing context-layer brief (for ontology / slice / metrics)

This is the mind file for attaching Context Layer to Ticketing.

**Do not invent new `tk.*` ids. Do not invent metric formulas. Do not send list questions to semantic. Do not send how-many questions to SQL. Writes stay on Ticketing Express — Context Layer never mutates Postgres.**

---

## How the three endpoints work (new contract)

Staff or portal user speaks in natural language. **The user never talks to Context Layer.** The **agent** understands the utterance using the slice already in its prompt, then calls a **typed** API.

| Endpoint | Purpose | What the agent sends | What it must not send |
|---|---|---|---|
| `POST /v1/ontology/slice` | Build the agent’s understanding | `organizationId`, `userId`, `product: "ticketing"`, `agent: tk.*` | Not a user question |
| `POST /v1/semantic/query` | Certified **number** only | `organizationId`, `userId`, `product: "ticketing"`, `agent: tk.reporting` (or mapped), `metrics: ["open_tickets_metric", …]` | **No** natural-language `query`. No ticket rows. |
| `POST /v1/sql/query` | **Rows** (list / search / one ticket / notes / audit) | `organizationId`, `userId`, `originProduct: "ticketing"`, `originAgent: tk.tickets` (or mapped), `instruction` the **agent** wrote, `entityHint` | Not a KPI. Not “how many”. |

`slice` returns:

- `prompt` — types, actions, taxonomies this agent may use. **Append to that agent’s system prompt.**
- `metrics[].id` — certified names this agent is allowed to **choose from**. The LLM maps “how many open tickets?” → `open_tickets_metric`. The API does not parse the sentence.

### Two different “ontology” products (do not mix)

| Name | Role | Used for |
|---|---|---|
| **New: ontology slice** | Meaning of Ticketing for **this** agent (Ticket vs Team vs KB, create vs list vs query_metric) | Every LLM agent prompt |
| **Old: ontology chat / KG** (`ask_ontology` today) | Knowledge-graph **why / drivers / root cause** for reports | Analytics “why did backlog rise?” only |

Rename in your head: old ontology agent = **knowledge graph / reports**. New slice = **purpose and vocabulary**.

---

## 1. Product modules (the screens)

These are the Ticketing **modules** (sidebar / views). An agent may only act in modules its role can open. Ontology types should match these rooms.

| Module id | What the human sees | What lives there |
|---|---|---|
| `create-ticket` | Create Ticket | File a **new** ticket (staff or portal) |
| `assigned` | Tickets (and ticket tabs) | My / assigned / searchable **existing** tickets |
| `search` | Ticket search (tab) | Org or scoped ticket search |
| `team-queue` / `team-inbox` / `unassigned` | Team / inbox / unassigned tabs | Same tickets, different list scope |
| `work-board` | Work board | Resolver board of tickets |
| `dashboard` | Dashboard (Home) | Snapshot KPIs: open, overdue, due today, unassigned, created today |
| `analytics` | Analytics (from Dashboard → View Analytics) | Charts, volume, SLA, CSAT trends — **numbers** |
| `csat-reports` | CSAT reports | Survey scores and rates — **numbers** |
| `audit` | Audit log | Event **rows** (who changed what), not a KPI |
| `agent-queues` | Teams | Queues / teams and members |
| `escalation-directory` | Escalation directory (under Teams) | Escalation contacts |
| `kb` | Knowledge Base | Articles (author vs recommend are different agents) |
| `customers` | Customers | Directory + 360 (read). **Create/edit customer is refused** in chat |
| `macros` | Macros | Saved reply templates |
| `priorities` | Priorities | Priority catalog + SLA hours; statuses live with this admin catalog |
| `org-preferences` | Org preferences | Org settings, widgets, API keys |
| `approvals` | Approvals | Staff confirm/reject of high-risk proactive writes |
| `internal-chat` | Internal Chat | Staff chat (not ticket public notes) |
| `settings` | Account Settings | Profile / security — not a Ticketing business agent |

**Portal** is the same product with fewer modules (`create-ticket`, `assigned`, `settings`). It is a **surface**, not its own agent.

Role → modules (who can even open the room):

| Role | Modules they can use |
|---|---|
| admin | All of the above except customer-only portal limits |
| agent | dashboard, search, assigned, team-inbox, unassigned, create-ticket, kb, customers, macros, internal-chat, settings |
| resolver | dashboard, search, assigned, work-board, kb, internal-chat, settings |
| viewer | dashboard, search, assigned, team-queue, kb, customers, analytics, settings |
| customer / portal | create-ticket, assigned (their tickets), settings |

Context Layer must still send `organizationId` + `userId` + product `ticketing`. Row scope follows this role.

---

## 2. How Ticketing agents are stacked

Staff coworker is **Super → Domain → Executor**. Super never files tickets or reads KPIs. Domain only picks an Executor + Skill. Executor talks to the user and calls tools.

Proactive codes (`tcaa`, `icpa`, …) are the same jobs on **events/cron**, not chat. They share the same ontology types as their chat twin.

Context Layer `agent` is a **slice id**, not the executor class name:

| Slice id | Who it covers |
|---|---|
| `tk.super` | `ticketing_super_agent` |
| `tk.tickets` | Create + existing-ticket work |
| `tk.reporting` | All certified **numbers** (chat analytics + TIAA) |
| `tk.admin` | Priority / status catalog (and nearby admin settings) |
| `tk.proactive` | Background / ASGA family |
| none until you add a preset | Teams, customers, KB authoring, macros (these **are live** in product) |

---

## 3. Who needs what (the three lists)

### A. Every LLM agent needs ontology slice

Put `POST /v1/ontology/slice` into **every** Super, Domain, and Executor prompt (and proactive LLM workers). The slice is **narrow**: only types and actions that agent is allowed to use.

**No slice (not an LLM):** `asga` — deterministic safety gate on Approvals. It does not get a prompt.

**Domains** still get a slice, but it is **planning vocabulary** (which Executor, which entity family) — not write actions and not 95 metrics.

### B. Agents that must **not** call semantic / query (no metrics)

These agents **list, collect, or mutate**. They must never call `POST /v1/semantic/query`. If the user asks “how many…”, Super remounts analytics (`tk.reporting`).

- `ticketing_super_agent`
- All five Domains (`intake_deflection_domain`, `triage_routing_domain`, `resolution_lifecycle_domain`, `knowledge_domain`, `catalog_administration_domain`)
- `ticket_creation_executor`
- `ticket_lifecycle_executor`
- `ai_resolution_executor`
- `classification_priority_executor`
- `intelligent_assignment_executor`
- `sla_escalation_executor`
- `investigation_summary_executor`
- `customer_reply_drafting_executor`
- `autonomous_resolution_executor`
- `resolution_quality_executor`
- `personalized_notification_executor`
- `resolution_knowledge_executor`
- `similar_ticket_detection_executor`
- `team_queue_crud_executor`
- `kb_quality_crud_executor`
- `macro_crud_executor`
- `customer_directory_crud_executor`
- `priority_status_crud_executor`
- `org_settings_integrations_executor`
- `notification_inbox_executor`
- `automation_rule_crud_executor`
- Proactive: `tcaa`, `dssa`, `icpa`, `itra`, `tsaa`, `sema`, `crda`, `ara`, `rqa`, `pna`, `rkaa`, `stda`
- `asga`

**Optional numbers later (not default):** `workload_optimization_executor` / `wloa` today use Home **dashboard snapshot** (open / overdue / unassigned), not certified semantic. Do not entitle the full reporting pack unless you decide workload KPIs belong there.

### C. Agents that **do** call semantic / query (metrics)

The LLM reads metric **names** from its slice, then calls `POST /v1/semantic/query` with those **ids**. Always `product: "ticketing"`. Always `agent: tk.reporting` for the full certified pack.

| Agent | Slice id | When |
|---|---|---|
| `analytics_audit_query_executor` | `tk.reporting` | Staff: how many, CSAT, SLA %, volume, dashboard numbers |
| `insights_analytics_executor` | `tk.reporting` | Staff: insights / combined value |
| `tiaa` | `tk.reporting` | Scheduled / on-demand insights (no chat bubble) |
| `root_cause_learning_executor` / `rcaa` | `tk.proactive` for job; **metrics via `tk.reporting`** | Outcome / routing learning that needs a KPI value |

**Why / drivers** after a number: call the **old ontology / KG** endpoint (reports), not slice, not semantic.

---

## 4. Tools to replace (old → new)

Nothing in Ticketing is deleted in this brief. This is the **intended** swap when you wire Context Layer.

| Old Ticketing tool | What it does today | Replace with | Keep? |
|---|---|---|---|
| `ask_semantic_layer` | Sends the **user’s sentence** to `/ask` | `POST /v1/semantic/query` with `metrics[]` the **agent chose** from slice | **Replace.** Same Skill name can stay; the body must not be NL. |
| `ask_ontology` | KG stream “why / drivers” | Keep as **knowledge-graph / reports** agent | **Keep.** Do not replace with `/v1/ontology/slice`. |
| `list_tickets` / `portal_list_tickets` | Ticket **rows** via Express | Optional `POST /v1/sql/query` `originAgent: tk.tickets` `entityHint: wt:Ticket` | **Keep Express until SQL Super has the same filters + RBAC.** Dual-run is OK. Never use this for counts. |
| `list_ticket_notes` | Note rows | SQL Super `entityHint` note / `wt:TicketNote` | Keep Express until parity |
| `list_audit` | Audit **rows** | SQL Super entity audit | Keep Express until parity |
| `list_customers` / `get_customer_360` | Customer rows + their tickets | SQL later if you add `tk.customers` | Keep Express |
| `get_metrics` | Home snapshot (5 numbers) | Semantic **or** keep Express as failsafe | **Keep as failsafe** if MetricFlow is down. Do not use for “show these tickets”. |
| `get_analytics` | Chart payloads | Semantic only if you certify the same charts | Keep until then |
| `get_csat_reports` | CSAT report payload | Semantic CSAT ids **or** keep Express | Keep UI export path |
| `export_analytics` | CSV download | None | **Keep Express** |
| All `create_*` / `update_*` / `delete_*` / `escalate_*` / `resolve_*` | Writes | **Never** Context Layer | **Keep** |

**SQL Super is not a second metric engine** while semantic is up. It is:

1. The row path for “show / list / open these tickets (or notes / audit)”.
2. A **failsafe** for KPI **templates** only if MetricFlow is down **and** the formula matches the certified metric. Prefer `get_metrics` for the five Home numbers as that failsafe already exists.

The agent chooses: utterance is a **number** → semantic + metric ids. Utterance is **records** → SQL Super or existing list tools.

---

## 5. Certified metric families (what you may attach)

Source of truth: your certified ticketing file. **Always `product: "ticketing"`.** Never CCaaS.

There is **no** certified id named `sla_breach_rate` or `resolution_rate`. Use the names below.

### Headline set for the reporting **prompt** (few names the LLM sees first)

| Certified id | Human meaning |
|---|---|
| `open_tickets_metric` | How many tickets are open |
| `high_priority_open_tickets_metric` | Open and high/urgent |
| `ticket_volume` | How many tickets in the period |
| `average_resolution_time_hours` | Average time to resolve |
| `average_csat_score` | Average CSAT (1–5) |
| `reopen_rate` | Share of tickets that reopened |
| `resolution_sla_compliance_rate` | Share that met resolution SLA (not “breach rate”) |
| `breached_tickets_metric` | Count that already breached |

Optional headlines that match Home: `current_overdue_tickets_metric`, `due_today_tickets_metric`, `unassigned_tickets_metric`, `tickets_created_today_metric`.

### Full API pack (`tk.reporting` may query any of these)

**Volume / backlog:** `ticket_volume`, `open_tickets_metric`, `active_tickets_metric`, `pending_tickets_metric`, `closed_tickets_metric`, `resolved_tickets_metric`, `reopened_tickets_metric`, `tickets_created_today_metric`, `tickets_last_7_days`, `tickets_last_30_days`, `average_tickets_per_day`, `open_ticket_age_days_total`, `average_open_ticket_age_days`, `days_since_last_ticket`

**Assignment / people:** `unassigned_tickets_metric`, `unassignment_rate`, `assigned_tickets_metric`, `assignment_rate`, `tickets_with_resolver_metric`, `tickets_without_resolver_metric`, `active_agents_metric`, `customers_served`, `accounts_served`, `active_customers_metric`

**SLA / time:** `breached_tickets_metric`, `current_overdue_tickets_metric`, `due_today_tickets_metric`, `sla_at_risk_tickets_metric`, `unanswered_tickets_metric`, `average_overdue_hours`, `queues_at_risk_metric`, `average_resolution_time_hours`, `resolution_hours_total`, `average_first_response_hours`, `average_first_response_minutes`, `first_response_sla_compliance_rate`, `first_response_coverage_rate`, `resolution_sla_compliance_rate`, `resolution_sla_met_metric`, `first_response_sla_met_metric` (+ supporting totals in the certified file)

**CSAT:** `average_csat_score`, `csat_response_rate`, `csat_rated_metric`, `csat_promoter_metric`, `csat_neutral_metric`, `csat_detractor_metric`, `csat_promoter_rate`, `csat_detractor_rate`, `csat_score_total`

**Quality / motion:** `reopen_rate`, `escalation_volume`, `escalation_rate`, `reassignment_volume`, `note_volume`, `internal_note_volume`, `customer_reply_volume`, `internal_note_ratio`, `average_notes_per_ticket`

**Catalog / ops:** `queue_count`, `queue_coverage_count`, `distinct_queues_covered`, `distinct_agents_in_queues`, `kb_article_volume`, `kb_published_article_metric`, `kb_views_total`, `macro_volume`, `notification_volume`, `unread_notifications_metric`, `outbound_email_volume`, `audit_event_volume`

**Proactive / approvals (reporting only):** `recommendation_volume`, `accepted_recommendations_metric`, `dismissed_recommendations_metric`, `open_recommendations_metric`, `recommendation_acceptance_rate`, `approval_volume`, `approved_metric`, `rejected_metric`, `pending_approvals_metric`, `approval_rate`, `average_decision_hours`, `proactive_audit_volume`

**Scope the agent must decide (not the API inventing it):** org-wide vs “my tickets” / “my team”. Today Ticketing Home can be org or self. Pass `userId` on every semantic call so you can honor that. Group-by (queue, priority, assignee, channel, time) is a reporting concern — still a **number** (or a small table of numbers), never a ticket list.

---

## 6. Ontology vocabulary (shared types)

Use Ticketing names. Map to `wt:*` only when obvious.

| Ticketing name | wt:* if obvious | Notes |
|---|---|---|
| Ticket | `wt:Ticket` | Core work item |
| Ticket note | `wt:TicketNote` | Internal vs customer-visible |
| Customer / contact | `wt:Customer` | Spoke overlay on hub Contact. **No create in chat.** |
| Team / queue | `wt:Team` | `agent_queues` |
| Knowledge article | `wt:KnowledgeArticle` | Authoring ≠ recommend |
| Macro | `wt:Macro` | Saved reply |
| Priority / SLA hours | `wt:SLA` | Catalog row, not a live clock |
| Ticket status | — | Catalog: Open, Pending, Reopened, Resolved, Overdue |
| Staff agent / resolver | — | L1 assignee vs L2 resolver — different columns |
| Notification | — | Staff inbox |
| Audit event | — | Rows, not a KPI |
| Approval | — | ASGA confirm |
| Order | — | Read-only on create (commerce), not a Ticketing type to invent |

**Enums as stored (do not invent others):**

- Status: `Open`, `Pending`, `Reopened`, `Resolved`, `Overdue` (no `On Hold`)
- Priority: `urgent`, `high`, `medium`, `low`
- Channel: `Email`, `Chat`, `Phone`, `Web`
- Queue names: per-org, not a global enum
- Note: `internal` vs public
- CSAT: integer 1–5

---

## 7. Agents — job, modules, ontology, metrics

### `ticketing_super_agent` → `tk.super`

**Job.** Read the utterance and either continue the live task or send work to one Domain. Greet or refuse only. Never collect ticket fields. Never answer “how many” or “show these tickets”.

**Must not.** `create_ticket`, metric ids, SQL lists, inventing rows.

**Modules.** All modules the signed-in role can open (it only **routes** into them).

**Ontology in prompt.** Domains and route actions: `route_to_domain`, `continue_active_task`, `resume_task`, `refuse_capability`. Entity **names** so it can tell Ticket vs Team vs KB vs Analytics. **No** write actions. **No** metric allowlist (or at most: “how-many → catalog analytics Domain”).

**Metrics.** None.

**SQL.** None.

---

### Domains (all → slice id `none`, still inject a **domain** slice)

Same pattern for all five: pick Executor + Skill; do not call semantic or SQL.

| Domain | Job | Modules it may send work into | Ontology (planning only) |
|---|---|---|---|
| `intake_deflection_domain` | New file vs how-to deflection | `create-ticket`, `kb` (search) | Ticket create vs KB search. Not close/reopen. |
| `triage_routing_domain` | Classify, assign, workload, learn | `assigned`, Teams | Ticket, queue, assignee/resolver. Not file-new. |
| `resolution_lifecycle_domain` | Existing ticket rows + mutations + some insights Skills | `assigned`, tabs, `work-board` | Ticket, note, assign, escalate, resolve. **Not** KPI counts. |
| `knowledge_domain` | Recommend article / similar tickets | `kb`, open ticket | Ticket + article **read**. Not KB publish. |
| `catalog_administration_domain` | Catalog + **analytics** + customer **read** | Teams, KB, customers, macros, priorities, dashboard, analytics, CSAT, audit, prefs, inbox, approvals | Team, KB write, macro, customer read, priority/status, **query_metric**, list_audit. **Not** ticket create/update. **Not** customer write. |

---

### `ticket_creation_executor` → `tk.tickets`

**Job.** Collect customer → verify contact → optional order → confirm → create ticket (staff or portal). Internal duplicate search must **not** be shown as a ticket table.

**Modules.** `create-ticket`. Portal: same.

**Ontology.** Types: Ticket, Customer (verify), Order (read). Actions: `create_ticket` (and portal create). Taxonomy: channel, priority (if collected), category as user text.

**Metrics.** None.

**SQL.** None (duplicate check stays an internal list, not SQL Super for the user).

---

### `ticket_lifecycle_executor` → `tk.tickets`

**Job.** Browse, search, page, open one ticket; notes; update fields; reassign; escalate; resolve / reopen. If the user asks a **count**, return to Super — do not count the list.

**Modules.** `assigned`, `search`, `team-queue`, `team-inbox`, `unassigned`, `work-board`. Portal: `assigned`.

**Ontology.** Types: Ticket, TicketNote, Team/queue, staff assignee vs resolver. Actions: list, get, update, note, reassign, escalate, resolve, reopen. Taxonomy: status, priority, channel, queue.

**Metrics.** None.

**SQL.** **Yes** — “show open tickets in Billing”, “tickets I created last month”, “notes on this ticket”. `originAgent: tk.tickets`, `entityHint: wt:Ticket` (or note).

---

### `ai_resolution_executor`

**Job.** Answer how-to from Knowledge Base without filing.

**Modules.** `kb`.

**Ontology.** Knowledge article list/get. No create_ticket unless Domain re-plans.

**Metrics.** None. **SQL.** None.

---

### `analytics_audit_query_executor` → `tk.reporting`

**Job.** Turn “how many / CSAT / SLA % / volume / dashboard numbers” into **metric ids** from its slice, then `semantic/query`. Audit Skill lists **rows**. Export stays Express. “Why” → KG reports agent.

**Modules.** `dashboard`, `analytics`, `csat-reports`, `audit`.

**Ontology.** Ticket as **aggregate** only. Actions: `query_metric`, `list_audit` (rows), read dashboard. Taxonomy: status, priority, channel, time grain. **No** `create_ticket`.

**Metrics.** Full certified pack. Prompt headlines = the eight (adjusted) names in section 5. API = all certified ids.

**SQL.** Audit rows only (`entityHint` audit). **Never** tickets-as-KPI.

---

### `insights_analytics_executor` / `tiaa` → `tk.reporting`

**Job.** Same numbers as analytics; insights combine value + (via KG) why. TIAA writes recommendations on a schedule — it does not chat.

**Modules.** `dashboard`, `analytics`, `approvals` (if a rec is proposed).

**Ontology.** Same as reporting (metric names + Ticket aggregate). No writes.

**Metrics.** Full pack. **SQL.** No (unless a rec needs a sample list — prefer tickets agent).

---

### `priority_status_crud_executor` → `tk.admin`

**Job.** Create / change / delete priority (label + resolution hours) and ticket statuses.

**Modules.** `priorities`.

**Ontology.** Priority / SLA hours, Status. Actions: list/create/update/delete those catalogs. Taxonomy: `urgent|high|medium|low`, status keys, terminal flag.

**Metrics.** None. **SQL.** None.

---

### `org_settings_integrations_executor` / `automation_rule_crud_executor` → `tk.admin` (medium)

**Job.** Org prefs, widgets, keys; automation if/then rules.

**Modules.** `org-preferences`, `settings` (account is not this agent).

**Ontology.** Org settings / automation rule types. No Ticket writes. No CSAT metrics.

**Metrics.** None.

---

### `team_queue_crud_executor` → none (live; add `tk.teams` if you want a slice id)

**Job.** Teams = queues + members.

**Modules.** `agent-queues`, `escalation-directory` (read).

**Ontology.** Team/queue, members, Private/Shared. CRUD + add/remove member.

**Metrics.** None. **SQL.** None (catalog lists stay Express).

---

### `customer_directory_crud_executor` → none (live; add `tk.customers`)

**Job.** List customers and 360 (tickets they raised). Super **refuses** add/edit/import contact.

**Modules.** `customers`.

**Ontology.** Customer read, Ticket list as **their history**. No `create_customer`.

**Metrics.** None.

**SQL.** Optional later for customer rows / their tickets. Until then Express list/360.

---

### `kb_quality_crud_executor` → none (live; add `tk.kb`)

**Job.** Author, publish, import/export articles and categories.

**Modules.** `kb`.

**Ontology.** Knowledge article CRUD/publish. Draft vs Published.

**Metrics.** None.

---

### `macro_crud_executor` → none (live; add `tk.macros`)

**Job.** Saved replies CRUD.

**Modules.** `macros`.

**Ontology.** Macro CRUD.

**Metrics.** None.

---

### `notification_inbox_executor` → none

**Job.** List / mark / clear staff notifications.

**Modules.** (inbox; not a primary sidebar id — notifications live in chrome / prefs.)

**Ontology.** Notification read/mark. No ticket writes. **Metrics.** None.

---

### Chat twins of proactive work → `tk.proactive` (no semantic except RCAA)

These may run in chat **or** on events. Slice = Ticket + the one action they own. **No reporting pack.**

| Agent | Job | Modules | Ontology actions | Metrics | SQL |
|---|---|---|---|---|---|
| `classification_priority_executor` / `icpa` | Set priority, category, queue | `assigned` (open ticket) | update classify | No | No |
| `intelligent_assignment_executor` / `itra` | Best L1/L2 assign | `assigned`, Teams | assign | No | No |
| `workload_optimization_executor` / `wloa` | Balance load | Teams, dashboard | list + rebalance | Dashboard snapshot only | No |
| `root_cause_learning_executor` / `rcaa` | Learn from outcomes | analytics (value) | read metrics + tickets | **Yes — via tk.reporting ids** | No |
| `sla_escalation_executor` / `sema` | SLA risk + escalate | `assigned` | escalate, notify | No | No |
| `investigation_summary_executor` / `tsaa` | Write investigation summary | open ticket | update summary | No | No |
| `customer_reply_drafting_executor` / `crda` | Draft customer reply | open ticket, `macros` | note / draft | No | No |
| `autonomous_resolution_executor` / `ara` | Propose resolve | open ticket, `approvals` | resolve (gated) | No | No |
| `resolution_quality_executor` / `rqa` | Quality check | open ticket | read ticket/notes | No | No |
| `personalized_notification_executor` / `pna` | Staff ping | notifications | notify | No | No |
| `resolution_knowledge_executor` / `rkaa` | Recommend article for **this** ticket | `kb`, open ticket | recommend (not publish) | No | No |
| `similar_ticket_detection_executor` / `stda` | Find similar tickets | `assigned` | list similar | No | rows of similar tickets via list/SQL |
| `tcaa` | Auto-create from intake | `create-ticket`, `approvals` | create (gated) | No | No |
| `dssa` | Deflect with KB | `kb` | search KB | No | No |

**`asga`:** no ontology slice. Approvals module only.

---

## 8. Map runtime → `tk.*` (do not invent ids)

| runtime | tk.* | Why |
|---|---|---|
| `ticketing_super_agent` | `tk.super` | Router |
| Five Domains | none | Planner slice only |
| `ticket_creation_executor`, `ticket_lifecycle_executor` | `tk.tickets` | Create + lists + lifecycle |
| `analytics_audit_query_executor`, `insights_analytics_executor`, `tiaa` | `tk.reporting` | Numbers |
| `priority_status_crud_executor` | `tk.admin` | Catalog |
| Org settings / automation | `tk.admin` | Admin, not analytics |
| Teams / customers / KB author / macros | none | Live; wait for optional presets |
| All listed proactive codes + chat twins | `tk.proactive` | Background family |
| Portal | not an agent | Surface on `tk.tickets` |

Do **not** put NL analytics on `tk.admin`. Admin ≠ reporting.

---

## 9. What to put in each slice (builder checklist)

| Slice | Types | Actions | Taxonomy | Metric names in prompt |
|---|---|---|---|---|
| `tk.super` | Domain names, Ticket/Team/KB/Customer as **labels** | route, continue, resume, refuse | none | none (hint: counts → reporting Domain) |
| `tk.tickets` | Ticket, TicketNote, Customer (verify/read), Team | create, list, get, update, note, assign, escalate, resolve, reopen | status, priority, channel, queue, assignee vs resolver | **none** |
| `tk.reporting` | Ticket (aggregate), CSAT, SLA, Audit | `query_metric`, list_audit, KG-why (pointer only) | status, priority, channel, time | Headlines in §5; API = full certified list |
| `tk.admin` | Priority/SLA hours, Status | catalog CRUD | priority keys, status keys | **none** |
| `tk.proactive` | Ticket, Team, KB (subset), Notification, Approval | the one mutation that agent owns (ASGA-gated) | status, priority, queue | **none** except RCAA/TIAA as above |

---

## 10. Identity on every Context Layer call

Send what Ticketing already has on a staff turn:

- `organizationId` — tenant (`accounts.organizations.id`). Example with data: `1000`.
- `userId` — `ticketing.agents.id` (sample `1000`). Not always MyAccount id.
- Role — `admin` / `agent` / `resolver` / `customer` / `viewer`.
- Current ticket — only if the UI has one focused (this ticket / here).
- Customer / `cdpId` — only after 360 or portal session.
- Team — not on the login object; comes from queues.

Example staff envelope (secrets redacted):

```json
{
  "organizationId": "1000",
  "userId": "1000",
  "userRole": "admin",
  "module": "assigned",
  "focusedEntity": { "type": "ticket", "id": "12503" }
}
```

---

## 11. Decision rules the ontology builder must not break

1. User asks a **number** → Super routes to reporting → agent picks **certified ids** → `semantic/query`. Product is always `ticketing`.
2. User asks to **see records** → tickets (or audit/notes) → `sql/query` or existing list tools. Not semantic.
3. User asks to **change** a ticket / catalog → Express tools + confirm. Not Context Layer.
4. User asks **why** a KPI moved → KG / old ontology chat. Not slice. Not semantic-only.
5. Slice for Super must not include `create_ticket` or 95 metrics.
6. Slice for tickets must not include CSAT metric packs.
7. Unknown agents get **no** metrics and only a slice when we map them.
8. Customer **write** is not a Ticketing capability — do not add `create_customer` to any slice.
9. `ask_semantic_layer` (NL `/ask`) is the tool you **retire** in favor of metric-id query.
10. SQL Super failsafe for KPIs is last resort; Home five numbers already have Express `get_metrics`.

---

## 12. Open gaps (for Context Layer, not Ticketing)

1. Who maps “CSAT this week” → `average_csat_score` + time? **The reporting agent**, using slice metric names — not the HTTP API.
2. `userId` must be on semantic calls if “my tickets” is a real scope.
3. Teams / customers / KB / macros need new `tk.*` presets if you want slices for those live executors.
4. Auth to `:8765` is not in Ticketing yet — do not assume MCP JWT works.
5. Do not alias `sla_breach_rate` until you certify it.

---

*This file is the attach spec. It does not change Ticketing code.*
