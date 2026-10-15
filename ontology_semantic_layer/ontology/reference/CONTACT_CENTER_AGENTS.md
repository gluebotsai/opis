# Worktual NLP Multi-Agent System — Guide for LLM Fine-Tuning Data Collection

**Audience:** LLM fine-tuning / conversation-data team  
**Scope:** AI Contact Center agents in `apps/nlp` (current runtime) + Contact Center target MAS inventory  
**Status:** Current production NLP agents; mapped to Contact Center 3-level architecture where applicable  
**Related:** `docs/WORKTUAL_MULTI_AGENT_ARCHITECTURE.md` (target spoke MAS)

---

## 1. Purpose of this document

Use this guide to:

1. Understand which **Contact Center agents** exist and what each one does (step by step).
2. Know which tools each agent can call.
3. Understand how multi-agent routing works (who talks when).
4. Collect **complete agent conversation traces** suitable for SFT / preference / tool-calling fine-tuning.

Fine-tuning data should capture **full agent turns**, not only the final user-visible reply.

**Primary product spoke for this corpus:** AI Contact Center (live conversations, routing, queues, agent assist, workforce, performance).

---

## 2. System overview

Worktual NLP backend (`apps/nlp`) currently runs these **Contact Center–facing** agent products:

| Product path | Contact Center role | Entry style | Multi-agent? | Typical use |
|---|---|---|---|---|
| **Coworker / Copilot** | Agent Assist + Workforce + Performance executors | Chat (SSE/REST) | Yes — router + specialists | Internal human-agent / admin co-worker |
| **Support bot** | Omnichannel AI Support executor | Chat / messaging channels | Single specialist (MCP tools) | Generic customer support bot |
| **Custom Lola Worktual** | Omnichannel AI Support (tenant custom) | Chat | Yes — Sales / Booking / Service | Tenant-specific customer bot |
| **Sentiment** | Interaction Quality signal | API | No — direct LLM | Turn/session sentiment |
| **Proactive** | Interaction Recovery signal | API / event | No — direct LLM (+ light logic) | Callback / recovery assignment |

**Design direction:**

- **Chat queries** → multi-agent (today ~2 levels; target Contact Center Super → Domain → Executor).
- **API / cron / timed events** → direct LLM prompt call (not full multi-agent).

---

## 2A. Contact Center agents (target inventory + current NLP map)

This section names the **AI Contact Center** agents from the product MAS. Use it so fine-tuning corpora are labeled as Contact Center agents (not generic chatbots).

### 2A.1 Contact Center hierarchy (target)

```text
Level 1: Contact Center Super Agent
    │
    ├─ Level 2: Omnichannel Engagement Domain Agent
    │     └─ L3: AI Support | Channel Adaptation | Customer Identification & Merge
    │
    ├─ Level 2: Interaction Operations Domain Agent
    │     └─ L3: Interaction Recovery | Follow-Up Management | Interaction Closure
    │
    ├─ Level 2: Agent Assist Domain Agent
    │     └─ L3: Support Agent Coworker | Real-Time Compliance | Interaction Quality
    │
    ├─ Level 2: Workforce Management Domain Agent
    │     └─ L3: Queue Management | Agent Presence Monitoring | Forecasting & Scheduling
    │
    └─ Level 2: Performance Intelligence Domain Agent
          └─ L3: Scheduled Reporting | Operational Anomaly
```

Full definitions: `docs/WORKTUAL_MULTI_AGENT_ARCHITECTURE.md` §6.

### 2A.2 Contact Center agent catalog (names + responsibility)

| Level | Contact Center agent | Status | Responsibility |
|---|---|---|---|
| L1 | **Contact Center Super Agent** | Target | Channel/domain selection; context across bot↔human; recovery/follow-up/closure coordination; CRM/ticketing handoffs; consent/recording policy |
| L2 | **Omnichannel Engagement Domain Agent** | Target | Supervise customer-facing engagement executors |
| L3 | **AI Support Agent** | Implemented (partial) | Understand intent, answer routine questions, permitted actions, hand over to live agent |
| L3 | **Channel Adaptation Agent** | Proposed | Adapt style/latency for voice, webchat, social |
| L3 | **Customer Identification & Merge Agent** | Implemented (partial) | Match interaction to customer; enrich/link profiles (merge remains approval-gated) |
| L2 | **Interaction Operations Domain Agent** | Target | Supervise recovery, follow-up, closure |
| L3 | **Interaction Recovery Agent** | Implemented (partial) | Recover missed/failed/dropped/unassigned interactions (proactive + monitoring callbacks) |
| L3 | **Follow-Up Management Agent** | Implemented (partial) | Create/track follow-up tasks and due times |
| L3 | **Interaction Closure Agent** | Implemented (partial) | Summarize outcome; suggest disposition / wrap-up |
| L2 | **Agent Assist Domain Agent** | Target | Supervise live-agent assist executors |
| L3 | **Support Agent Coworker** | Implemented | Suggest replies, knowledge, next actions; approved tasks for the human agent |
| L3 | **Real-Time Compliance Agent** | Proposed | Disclosures, prohibited language, risky actions during live interactions |
| L3 | **Interaction Quality Agent** | Implemented (partial) | Score/summarize interaction quality (sentiment today; broader QA later) |
| L2 | **Workforce Management Domain Agent** | Target | Supervise queues, presence, scheduling |
| L3 | **Queue Management Agent** | Implemented | Create/modify/remove queues and membership under policy |
| L3 | **Agent Presence Monitoring Agent** | Implemented | Monitor agent states, escalations, force logout / presence |
| L3 | **Forecasting & Scheduling Agent** | Proposed | Forecast demand; recommend staffing |
| L2 | **Performance Intelligence Domain Agent** | Target | Supervise reporting and anomaly detection |
| L3 | **Scheduled Reporting Agent** | Implemented (partial) | Generate agent/queue performance reports and charts |
| L3 | **Operational Anomaly Agent** | Proposed | Detect abnormal SLA, containment, queue, channel behavior |

### 2A.3 Map: Contact Center agent → current NLP runtime id

| Contact Center agent (product name) | Current NLP agent / entry | Notes for FT labeling |
|---|---|---|
| AI Support Agent | `support_bot`, Lola `SalesAgent` / `BookingAgent` / `ServiceAgent` | Customer-facing Contact Center bots |
| Customer Identification & Merge | `contact_enrich` flows inside `support_bot`, `inbox`, Lola; coworker `contact` | Label episodes with identity/enrich tools |
| Support Agent Coworker | coworker: `general`, `inbox`, `contact`, `task`, … | Internal co-worker assisting **human** contact-center agents |
| Queue Management Agent | coworker `queue` | Queue create/update/delete workflows |
| Agent Presence Monitoring Agent | coworker `monitoring` | Snapshot, presence, logout, callbacks |
| Scheduled Reporting / Performance | coworker `analytics` | KPIs, plots, reports, ontology/semantic |
| Follow-Up Management | coworker `task` + inbox follow-up triggers | Task list/open/update; callback tasks |
| Interaction Recovery | `proactive` + monitoring callback tools | Headless assignment + supervisor callback create |
| Interaction Quality | `sentiment` (+ future QA agents) | Turn/session sentiment API |
| Interaction Closure | workspace wrap-up assist APIs | Disposition/wrap-up suggestions (adjacent to sentiment) |
| Contact Center Super / Domain Agents | **Not separate runtime agents yet** | Today surface-start + `route_to_agent` approximates Super/Domain |

**FT tagging tip:** store both fields on every episode:

- `product_spoke`: `ai_contact_center`
- `cc_agent_name`: e.g. `Support Agent Coworker` / `AI Support Agent` / `Queue Management Agent`
- `nlp_agent_id`: e.g. `inbox` / `support_bot` / `queue`

### 2A.4 Who talks to whom (Contact Center view)

```text
Customer (webchat / WhatsApp / social / email)
    → AI Support Agent          [support_bot | custom_lola_*]
         optional: Customer Identification (contact_enrich)
         optional: handoff → human live agent

Human contact-center agent / supervisor (Worktual UI)
    → Support Agent Coworker    [coworker specialists]
         inbox / contact / task / queue / analytics / monitoring / general
         route_to_agent between specialists

Timed / ops events
    → Interaction Recovery      [proactive]
    → Interaction Quality       [sentiment]
```

Human **live agents** are not LLM agents; they are the Contact Center workforce. Coworker and inbox assist those humans. Customer bots are the Contact Center AI Support path before/without a human.

---

## 3. How the multi-agent system works (Coworker / Support Agent Coworker)

### 3.1 High-level flow

```text
User message (UI coworker chat)
        │
        ▼
Copilot API  (auth + RunContext: tenant, user, role, surface, path, ids)
        │
        ▼
AgentRouter
        │
        ├─ Pick starting agent from current UI surface/path
        │    e.g. contacts page → contact agent
        │         inbox → inbox agent
        │         performance → analytics agent
        │         else → general
        │
        ▼
Active Agent (LLM)
        │
        ├─ May call MCP tools (domain actions)
        ├─ May call route_to_agent (handoff to another specialist)
        │
        ▼
If route_to_agent:
        Router switches active agent
        Injects handoff system note
        Target specialist continues (often after UI navigation)
        │
        ▼
Final assistant text (+ optional drafts / navigation SSE events)
```

### 3.2 Runtime steps (every coworker turn)

1. Authenticate JWT; build `RunContext` (tenant, user, role, surface, path, conversation/contact/task/queue ids).
2. Build message list = prior history + new user message.
3. Choose **starting specialist** from current UI surface (see table below).
4. Run the LLM agent loop:
   - Model may reply with text only, or with one or more tool calls.
   - Tool results are appended as `role=tool` messages; loop continues until a final assistant message.
5. If the model calls `route_to_agent`:
   - Strip routing prose from the routing turn.
   - Switch active agent to the target specialist.
   - Inject a handoff system note: handle the request now; do not mention routing.
   - UI may navigate to that specialist’s home path.
6. Stream SSE events: text deltas, routing, drafts (contact/queue), actions, done.
7. Persist/session memory for the conversation (working short-term context).

### 3.3 Important runtime rules

1. **Routing is LLM tool-based** via `route_to_agent` (not keyword/regex intent maps for coworker specialists).
2. **Surface + role authorize tools.** An agent may be defined with MCP servers, but the current page/role can still deny some tools.
3. **Trusted context is server-side.** Tenant/user/role/surface/ids come from auth + request context.
4. **Handoff hygiene:** target agent must not mention handoffs/routing/other agents.
5. **Mutating actions** often require staged drafts + natural-language confirmation before commit.
6. **When routing:** call `route_to_agent` alone that turn (no other tools); leave assistant content empty.

### 3.4 Starting agent by surface (coworker)

| UI surface / area | Starting agent |
|---|---|
| contacts list/detail | `contact` |
| inbox / workspace conversation | `inbox` |
| tasks | `task` |
| queues / workforce | `queue` |
| performance / reports | `analytics` |
| monitoring | `monitoring` |
| general / dashboard / other | `general` |

After start, the LLM may hand off to another specialist with `route_to_agent`.

---

## 4. Clear steps — what each Contact Center NLP agent does

This section is the primary reference for labeling and collecting traces. For each runtime agent: **Contact Center name**, **job**, **when it starts**, **step-by-step behavior**, **tools**, **success criteria**.

---

### 4.1 `general` — Support Agent Coworker (default / org + navigation)

**Contact Center agent:** Support Agent Coworker (general entry)  
**Job:** Default co-worker. Answer org/nav questions; route domain work to specialists.

**When it starts:** Dashboard, general surfaces, or when no specialist surface matches.

**Steps the agent follows:**

1. Read the user request and current surface/role.
2. If the request is small talk / “who are you” → reply in compact HTML; no tools.
3. If the user only wants to open a page (“go to contacts”) → call `navigate` with the correct path.
4. If the request needs org facts (address, hours, directory) → call `get_organization_details`.
5. If the request needs company/product/support FAQ → call `get_organization_knowledge` once (`module` = `business` | `product` | `support`).
6. If the customer (via coworker) needs live-agent handoff recommendation → call `recommend_live_agent_handoff` when appropriate.
7. If the request belongs to another domain (contacts, inbox, tasks, queues, analytics, monitoring) → call **only** `route_to_agent` with specialist name + short query; leave content empty.
8. Never invent org data; never claim a handoff unless `route_to_agent` was called.

**Tools:** `navigate`, `get_organization_details`, `get_organization_knowledge`, `recommend_live_agent_handoff`, `route_to_agent`

**Collect for FT:** correct navigate vs route decisions; empty-content routing turns; grounded org answers.

---

### 4.2 `contact` — Support Agent Coworker (contacts) + Customer Identification

**Contact Center agent:** Support Agent Coworker / Customer Identification & Merge (assist path)  
**Job:** Find, create, and update contacts with draft staging and confirmation.

**When it starts:** Contacts list/detail surfaces, or after `route_to_agent(contact)`.

**Steps — search:**

1. Call `list_contacts` for search/list (never invent contacts from memory).
2. Call `get_contact` for one authoritative profile before answering detail questions.
3. Reply with concise HTML identifying matches; ask one clarifying question if ambiguous.

**Steps — create (multi-turn workflow):**

1. On create intent, immediately call `stage_contact_draft` (`mode=create`, `nextField=firstName`, …) before the first question (unless values already given).
2. Ask **one** focused question at a time; merge every value the user provides into the draft.
3. On every gathering turn, call `stage_contact_draft` again with cumulative values + `skippedFields` + exactly one `nextField` / `nextQuestion`.
4. Follow field order:
   1. `firstName` (mandatory)
   2. `lastName` (optional)
   3. `primaryEmail` (mandatory unless phone already present)
   4. `primaryPhone` (mandatory unless email already present)
   5. `secondaryPhone` / WhatsApp (optional; may copy primary)
   6. `gender` (optional)
   7. `city` (optional)
   8. `country` (optional)
5. Validate email/phone conversationally before staging; allow skip on optionals.
6. When mandatory fields are done and optionals answered/skipped → stage with `nextField=null` and ask for confirmation.
7. On natural-language confirm (“yes”, “create”, …) → call `create_contact` in the **same** turn.
8. Do not claim create succeeded without the tool; UI opens the contact profile after create.

**Steps — update:**

1. Resolve contact; call `get_contact`.
2. Stage complete before/after preview (`stage_contact_draft`); change only requested fields.
3. Ask for confirmation; on confirm call `update_contact` same turn.
4. Deletion is unsupported → offer `isActive=false` instead.

**Steps — skills (when relevant):** use skill MCP tools to list/get/update/remove skills.

**Tools:** `list_contacts`, `get_contact`, `stage_contact_draft`, `create_contact`, `update_contact`, `contact_enrich`, skill tools, `route_to_agent`

**Collect for FT:** full draft loops; confirmation→mutate same turn; no restarted drafts; correct skip handling.

---

### 4.3 `inbox` — Support Agent Coworker (live inbox assist)

**Contact Center agent:** Support Agent Coworker  
**Job:** Help a **live human contact-center agent** already talking to a customer: load context, suggest replies, enrich contact, ground FAQ.

**When it starts:** Inbox/workspace surface, or after `route_to_agent(inbox)`.

**Steps the agent follows:**

1. Before summarizing or drafting, call `suggest_reply` or `get_conversation_context` to load authoritative conversation + `customer.contact`.
2. For company/product/policy/FAQ in the customer message → call `get_organization_knowledge` once (`business` | `product` | `support`).
3. If knowledge empty/fail → say not enough knowledge; do **not** retry another module.
4. Draft the **exact message** the live agent should send (no coaching labels, no “connecting you to an agent”).
5. If customer stated a profile field that is empty / explicit update / confirmed mismatch → call `contact_enrich`; honor `appliedFields` / `requiresConfirmation`.
6. On mismatch confirmation required → ask customer naturally in the drafted reply; retry enrich with `confirmedFields` only after clear approval.
7. If a live-agent follow-up promise is detected → trigger task creation for that callback.
8. Never claim the suggested reply was sent; never invent conversation facts.

**Tools:** `get_conversation_context`, `suggest_reply`, `summarize_conversation`, org/contact/skill tools, `route_to_agent`

**Collect for FT:** context-load-before-answer; grounded FAQ; enrich policy compliance; draft-only replies.

---

### 4.4 `task` — Follow-Up Management (coworker tasks)

**Contact Center agent:** Follow-Up Management Agent (via Support Agent Coworker)  
**Job:** List, inspect, open, and update tasks on My Tasks.

**When it starts:** Tasks list/detail surfaces, or after `route_to_agent(task)`.

**Steps the agent follows:**

1. Always call `list_tasks` or `get_task` before answering about counts/status/due dates (never invent).
2. Use correct filters: `tab=admin_assigned` | `coworker_assigned` | `done`; `due=today` | `overdue`.
3. Present concise list with enough fields to identify each task.
4. If user picks an ordinal (“2nd one”) → resolve against the **same** list order; re-list with same filters if needed.
5. On select / “open / work on / call back” → call `open_task_workspace` in the same turn (may assign conversation / change presence).
6. If `open_task_workspace` fails → call `navigate` with `/agent/tasks?task={id}`.
7. Use `update_task` only for explicit complete / dismiss / accept-suggestion (never substitute one for another).
8. If ambiguous which task → ask one clarification; do not invent ids.
9. Do not claim unsupported ops (create/reassign/priority/due changes) are available.
10. Every turn must include a short HTML reply (never tool-calls-only).

**Tools:** `list_tasks`, `get_task`, `update_task`, `open_task_workspace`, `navigate`, `route_to_agent`

**Collect for FT:** list→ordinal→open trajectories; correct tab filters; mutation only on explicit intent.

---

### 4.5 `queue` — Queue Management Agent

**Contact Center agent:** Queue Management Agent  
**Job:** Conversational queue setup with draft staging, staffing, and publish.

**When it starts:** Queue/workforce surfaces, or after `route_to_agent(queue)`.

**Steps — create (multi-turn workflow):**

1. On create intent (including right after handoff), first call `stage_queue_draft` (`mode=create`, `nextField=name`, …).
2. Lead conversationally; ask one field at a time; re-stage **all** collected values every turn.
3. Field sequence:
   1. `name` (mandatory)
   2. `team` (mandatory) — call `list_teams` same turn; show options
   3. `description` (optional)
   4. `status` (mandatory: active/inactive)
   5. `businessHours` (optional) — call `list_business_hours` same turn
   6. `shifts` (mandatory — at least one)
   7. `staffingMode` (specific / all / skip)
   8. `shiftAgents` — call `list_eligible_agents` first; only suggest returned agents
   9. `agentChannels` per added agent
   10. `addAnotherAgent` loop
   11. `review` when staffing complete/skipped
4. Only stage a field’s value **after** the user answers/skips it; then advance `nextField`.
5. When ready → stage `nextField=review`, ask to create.
6. On confirm → call `create_queue` same turn with staged values + shift agent assignments.

**Steps — manage existing:**

1. List/inspect via `list_queues` / related read tools as needed.
2. Status change → `update_queue_status`.
3. Delete → `delete_queue` (respect confirmation rules).
4. Presence/eligibility reads → `list_agents`, `list_eligible_agents`, `list_presence`.

**Tools:** queue MCP tools (`list_queues`, `list_teams`, `list_business_hours`, `stage_queue_draft`, `create_queue`, `update_queue_status`, `delete_queue`, `list_agents`, `list_eligible_agents`, `list_presence`), `route_to_agent`

**Collect for FT:** full create loops; list_options-before-ask; staffing subflow; confirm→create same turn.

---

### 4.6 `analytics` — Scheduled Reporting Agent

**Contact Center agent:** Scheduled Reporting Agent (Performance Intelligence)  
**Job:** Performance and dashboard analytics. Pick exactly one tool path per turn.

**When it starts:** Performance/reports/dashboard surfaces, or after `route_to_agent(analytics)`.

**Steps the agent follows:**

1. Classify **primary intent**: retrieval (number/chart) vs causal explanation (why/how/root cause).
2. Small talk → HTML only; zero tools.
3. Out-of-domain request → `route_to_agent` only (empty content).
4. Choose **one** path:

   **Path O — ontology (admin dashboard only, causal):**  
   Call `ask_ontology_layer` once for why/how/relationship questions. If `ok=true`, do not call another tool or repeat the answer.

   **Path S — semantic (mandatory first for KPIs):**  
   Call `ask_semantic_layer` first for rates, counts, mixes, trends, predefined metrics.  
   Fall back to `generate_performance_report` or `sql_analytics` only if semantic returns `ok=false`.

   **Path SQL / plot / report:**  
   Use `sql_analytics` / `generate_plot` / `generate_performance_report` when appropriate after semantic fail or for custom breakdowns. Prefer agent **names**, never raw UUIDs in charts.

5. Prefer ≤1 terminal data tool call; never repeat identical tool call in the same turn.
6. Reply in compact HTML: short findings + optional chart/card + one follow-up question.
7. Never paste SQL, tool names, or raw JSON in assistant text.

**Tools:** `ask_ontology_layer`, `ask_semantic_layer`, `sql_analytics`, `generate_plot`, `generate_performance_report`, skill/metric tools, `route_to_agent`

**Collect for FT:** correct Path O vs S; no mixed paths; grounded summaries; name columns for agent breakdowns.

---

### 4.7 `monitoring` — Agent Presence Monitoring Agent

**Contact Center agent:** Agent Presence Monitoring Agent (callbacks overlap Interaction Recovery)  
**Job:** Live monitoring for supervisors: snapshot, attendance, callbacks, force logout, presence, alert ack.

**When it starts:** Monitoring surface, or after `route_to_agent(monitoring)`.

**Steps — read live state:**

1. Call `get_monitoring_snapshot` (or narrower tool) **before** answering about waiting/missed/callbacks/SLA/presence.
2. Filter using exact tool fields (wait time, SLA breach, not-ready, capacity, etc.).
3. Lead with count/risk; list only actionable rows.
4. For attendance beyond today → `get_agent_attendance`.
5. For not-ready escalation detail → `get_not_ready_escalation_insight`.

**Steps — create callback:**

1. Resolve customer (snapshot row, `list_contacts`/`get_contact`, or conversation context).
2. Call `get_contact_callback_channels` when channel unknown.
3. Pick assignee using snapshot `agent.id` (setup user id); prefer capacity.
4. After supervisor confirms → `create_callback_task`.

**Steps — mutations:**

1. Force logout → `force_agent_logout` with `agent.agentId` (or resolvable `agentName`).
2. Ready / Not Ready → `set_agent_presence` (not logout).
3. If prior turn already identified one agent and user says “logout them” → call logout same turn.
4. Acknowledge alerts → `acknowledge_not_ready_escalation` / `acknowledge_proactive_callback`.
5. After success, state exactly what changed; never claim failed actions succeeded.
6. Every turn must include short HTML reply.

**Tools:** monitoring tools + `list_contacts`, `get_contact`, `navigate`, `route_to_agent`

**Collect for FT:** tool-before-answer; correct id types (setup user vs agent id); confirm→mutate; no invented counts.

---

### 4.8 `support_bot` — AI Support Agent (Contact Center)

**Contact Center agent:** AI Support Agent  
**Job:** Channel support bot (webchat, WhatsApp, Instagram, Facebook, email). Grounded org answers + optional enrich + live-agent handoff.

**When it starts:** Customer message on a supported channel via bot API.

**Steps the agent follows:**

1. Greetings / chit-chat → natural reply; no tools.
2. Org directory facts (address, phone, hours, website) → `get_organization_details`.
3. Company/product/policy/FAQ → `get_organization_knowledge` once with correct `module`.
4. If knowledge empty/fail → use tool message / offer live agent; do **not** retry another module.
5. Live agent only when customer explicitly asks (or accepts offer) → `recommend_live_agent_handoff`, then briefly say connecting.
6. When customer provides profile fields → `contact_enrich` per identity rules; claim only `appliedFields`.
7. On field conflict → enrich without `confirmedFields`, ask approval, retry with `confirmedFields`.
8. Never invent knowledge; never expose IDs/tool internals; ask one clarifying question when needed.
9. Format for channel (email more formal; chat/social brief).

**Tools:** `get_organization_details`, `get_organization_knowledge`, `recommend_live_agent_handoff`, `contact_enrich`, skill tools

**Collect for FT:** module choice; no double knowledge calls; enrich policy; handoff only on explicit ask.

---

### 4.9 Custom Lola Worktual — AI Support Agent (tenant custom)

**Contact Center agent:** AI Support Agent (custom tenant specialists)  
**Job:** Tenant-specific multi-agent customer bot. Router hands between specialists.

#### Shared steps (all Lola specialists)

1. Receive customer turn + session memory / long-term summary.
2. Enrich contact when customer explicitly states profile fields (`contact_enrich`).
3. Offer `LIVE_AGENT` or `CALL_BACK` when appropriate.
4. Use `route_to_agent` to hand to another Lola specialist when intent changes.
5. Customer-facing text only (no HTML/tool JSON leakage).

#### `SalesAgent` steps

1. Answer product/sales questions via `GET_SALES_KNOWLEDGE` (and `WEB_SEARCH_TOOL` when needed).
2. Qualify interest; keep conversation moving toward demo/booking when appropriate.
3. If customer wants to book → `route_to_agent` → `BookingAgent`.
4. If support/ticket intent → route to `ServiceAgent`.
5. Enrich identity when details are given; hand off to live agent/callback tools when requested.

#### `BookingAgent` steps

1. Collect/validate phone (`VALIDATE_PHONE_NUMBER`) and email (`VALIDATE_EMAIL`) as required.
2. Check availability with `CALENDAR_TOOL`.
3. Book with `BOOK_APPOINTMENT` or reschedule with `RESCHEDULE_APPOINTMENT`.
4. Confirm details back to customer; enrich contact as fields appear.
5. Escalate via `LIVE_AGENT` / `CALL_BACK` if booking cannot complete.

#### `ServiceAgent` steps

1. Answer service FAQ via `GET_SERVICE_KNOWLEDGE`.
2. For tickets: `VERIFY_CONTACT_FOR_TICKET` → `SEND_OTP` → `VERIFY_OTP` as required.
3. Create/track tickets: `CREATE_TICKET`, `GET_TICKET_STATUS`.
4. Validate email when needed; enrich contact; escalate with live agent/callback tools.

**Collect for FT:** specialist switches; validation→book sequences; OTP→ticket sequences; no premature “saved” claims.

---

### 4.10 `sentiment` — Interaction Quality Agent (partial)

**Contact Center agent:** Interaction Quality Agent  
**Job:** Score sentiment for a turn or summarize a session.

**Steps:**

1. Receive transcript turn or session payload via workspace API.
2. LLM returns structured sentiment JSON (score/label constraints).
3. No MCP tools; no routing.

**Collect for FT:** labeled turn/session pairs only; keep separate from coworker/tool corpora.

---

### 4.11 `proactive` — Interaction Recovery Agent (partial)

**Contact Center agent:** Interaction Recovery Agent  
**Job:** Pick best human agent + due timing for missed-contact callback recovery.

**Steps:**

1. Receive eligible agents, queue skills/description, miss channel, identities.
2. Choose exactly one agent by `setup_user_id` (prefer highest `skill_score`, then lowest open callbacks).
3. Choose `due_preset` ∈ {`1h`, `4h`, `eod`} and `channel` ∈ {whatsapp, instagram, facebook, email}.
4. If unreachable (e.g. webchat-only with no outreach identity) or no suitable agent → `skip=true` + reason.
5. Return JSON only.

**Collect for FT:** JSON assignment decisions; skip cases; no chat tool traces.

---

## 5. Agent ↔ tools catalog (quick reference)

### 5.1 Coworker specialists

| Agent ID | Purpose | MCP servers | Tools | Also |
|---|---|---|---|---|
| `general` | Org/nav + routing hub | `navigation`, `organization` | `navigate`, `get_organization_details`, `get_organization_knowledge`, `recommend_live_agent_handoff` | `route_to_agent` |
| `contact` | Contact CRUD | `contact`, `skill` | `list_contacts`, `get_contact`, `stage_contact_draft`, `create_contact`, `update_contact`, `contact_enrich`, skill tools | `route_to_agent` |
| `inbox` | Live reply assist | `conversation`, `contact`, `organization`, `skill` | `get_conversation_context`, `suggest_reply`, `summarize_conversation` + contact/org/skill | `route_to_agent` |
| `task` | Task ops | `task`, `navigation` | `list_tasks`, `get_task`, `update_task`, `open_task_workspace`, `navigate` | `route_to_agent` |
| `queue` | Queue setup | `queue` | `list_queues`, `list_teams`, `list_business_hours`, `stage_queue_draft`, `create_queue`, `update_queue_status`, `delete_queue`, `list_agents`, `list_eligible_agents`, `list_presence` | `route_to_agent` |
| `analytics` | Metrics/charts | `analytics`, `skill`, `metric` | `ask_ontology_layer`, `ask_semantic_layer`, `sql_analytics`, `generate_plot`, `generate_performance_report`, skill/metric tools | `route_to_agent` |
| `monitoring` | Live ops | `monitoring`, `contact`, `navigation` | snapshot/attendance/callback/logout/presence/ack tools + contact + `navigate` | `route_to_agent` |

### 5.2 Customer bots + direct agents

| Agent ID | Tools / notes |
|---|---|
| `support_bot` | Org + contact enrich + skill + live-agent recommend |
| Lola `SalesAgent` | `GET_SALES_KNOWLEDGE`, `WEB_SEARCH_TOOL`, `contact_enrich`, `LIVE_AGENT`, `CALL_BACK`, `route_to_agent` |
| Lola `BookingAgent` | phone/email validate, calendar, book/reschedule, enrich, live/callback, route |
| Lola `ServiceAgent` | service knowledge, OTP/ticket tools, enrich, live/callback, route |
| `sentiment` | none (direct LLM JSON) |
| `proactive` | none (direct LLM JSON) |

### 5.3 MCP servers (shared toolbox)

| MCP server | Tools |
|---|---|
| `organization` | `get_organization_details`, `get_organization_knowledge`, `recommend_live_agent_handoff` |
| `contact` | `list_contacts`, `get_contact`, `stage_contact_draft`, `create_contact`, `update_contact`, `contact_enrich` |
| `conversation` | `get_conversation_context`, `suggest_reply`, `summarize_conversation` |
| `task` | `list_tasks`, `get_task`, `update_task`, `open_task_workspace` |
| `queue` | `list_queues`, `list_teams`, `list_business_hours`, `stage_queue_draft`, `create_queue`, `update_queue_status`, `delete_queue`, `list_agents`, `list_eligible_agents`, `list_presence` |
| `analytics` | `ask_ontology_layer`, `ask_semantic_layer`, `sql_analytics`, `generate_plot`, `generate_performance_report` |
| `metric` | `list_metric_domains`, `get_metrics`, `get_metric`, `get_metric_schema`, `list_active_metrics`, `remove_metrics` |
| `skill` | `list_skills`, `get_skill`, `update_skill_in_system`, `remove_skill_from_system`, `list_active_skills` |
| `monitoring` | `get_monitoring_snapshot`, `get_agent_attendance`, `get_not_ready_escalation_insight`, `get_contact_callback_channels`, `create_callback_task`, `force_agent_logout`, `set_agent_presence`, `acknowledge_not_ready_escalation`, `acknowledge_proactive_callback` |
| `navigation` | `navigate` |

**Runtime-only handoff tool:** `route_to_agent` — hand conversation to another named specialist.

---

## 6. What a single “agent conversation” looks like

Treat **one user query → final assistant answer** as an **episode** (may span multiple agents).

### 6.1 Episode structure (recommended)

```text
episode_id
product_spoke: ai_contact_center
product: coworker | support_bot | custom_lola | sentiment | proactive
cc_agent_name: e.g. "Support Agent Coworker" | "AI Support Agent" | "Queue Management Agent"
nlp_agent_id / agents_involved[]
tenant_id / user_id / role / surface / path   (redact PII as required)
messages[]:
  - system (agent prompt / handoff note)     [optional; keep prompt_version id]
  - user
  - assistant (may include tool_calls)
  - tool (name, arguments summary, result summary)
  - assistant
  - ...
  - assistant (final user-visible content)
routing[]:
  - from_agent, to_agent, reason/query, timestamp
tools[]:
  - agent, tool_name, args_hash/redacted_args, ok/error, latency_ms
outcome:
  - final_text
  - drafts (contact/queue) if any
  - navigation paths if any
  - blocked/approval_required flags
labels (for FT):
  - success | needs_fix | bad_routing | bad_tool | policy_violation
```

### 6.2 Multi-agent episode example (coworker)

```text
User: "Create a contact for Priya and then show my open tasks"

1. general (or contact if already on contacts)
2. assistant tool_call: route_to_agent(contact, "create contact Priya...")
3. contact agent:
     tool_call: stage_contact_draft(...)
     … multi-turn field collection …
     tool_call: create_contact(...)          # after confirmation
4. assistant tool_call: route_to_agent(task, "list open tasks")
5. task agent:
     tool_call: list_tasks(...)
6. final assistant reply to user
```

**Collect all of the above**, including intermediate tool results (redacted), not only step 6.

### 6.3 Lola multi-agent episode example

```text
User: "I want to book a demo tomorrow"

1. SalesAgent may route_to_agent → BookingAgent
2. BookingAgent:
     VALIDATE_PHONE_NUMBER / VALIDATE_EMAIL / CALENDAR_TOOL / BOOK_APPOINTMENT
3. final booking confirmation text
```

---

## 7. Data collection requirements for fine-tuning

### 7.1 Must capture

| Field | Why |
|---|---|
| `agent_id` for every model call | Multi-agent attribution |
| Full tool call name + args (redacted) | Tool-calling FT |
| Tool result (redacted/truncated) | Teach correct grounded use |
| `route_to_agent` from/to + query | Routing FT |
| Surface/path/role | Tool authorization context |
| Prompt version / agent prompt version | Reproducibility |
| Final user-visible answer | Response quality |
| Confirmation/draft events | Teach approval-gated mutations |
| Error/empty-tool/fallback turns | Hard negative / recovery data |
| Workflow step id (optional) | e.g. contact `nextField`, queue `nextField` |

### 7.2 Strongly recommended labels

- **Routing quality:** correct specialist / wrong specialist / unnecessary hop
- **Tool quality:** correct tool, wrong tool, missing tool, hallucinated args
- **Workflow quality:** stayed on draft state / restarted incorrectly / asked duplicate field
- **Grounding:** answer supported by tool result / unsupported
- **Policy:** safe / unsafe / should have asked confirmation
- **UX:** concise, helpful, leaked internal routing language (bad)

### 7.3 Redaction rules (minimum)

Before export, remove or hash:

- Phone, email, account numbers, OTPs, auth tokens
- Raw recordings / full transcripts when not needed
- Tenant secrets, API keys
- Exact card/CVV/PIN (should never appear; drop if present)

Keep structural fields needed for learning (tool names, arg *shapes*, success/failure).

### 7.4 Split datasets by product

1. `cc_coworker_sft` — Support Agent Coworker + routing traces  
2. `cc_ai_support_sft` — AI Support Agent (`support_bot`) traces  
3. `cc_lola_sft` — AI Support (Lola Sales/Booking/Service) traces  
4. `cc_interaction_quality_sft` — Interaction Quality (`sentiment`)  
5. `cc_interaction_recovery_sft` — Interaction Recovery (`proactive`)  

Optional:

6. `cc_queue_mgmt_sft` — Queue Management Agent workflows only  
7. `cc_presence_monitoring_sft` — Agent Presence Monitoring traces  
8. `router_only_sft` — only turns that decide `route_to_agent`  
9. `tool_only_sft` — only tool-call trajectories  
10. `workflow_sft` — contact/queue multi-turn draft loops only  

---

## 8. Suggested export schema (JSONL — one episode per line)

```json
{
  "episode_id": "uuid",
  "product_spoke": "ai_contact_center",
  "product": "coworker",
  "cc_agent_name": "Support Agent Coworker",
  "created_at": "2026-09-02T12:00:00Z",
  "prompt_versions": {"contact": "v3", "general": "v5"},
  "context": {
    "tenant_id": "hash_or_id",
    "role": "admin",
    "surface": "contacts-list",
    "path": "/admin/contacts"
  },
  "agents_involved": ["general", "contact"],
  "cc_agents_involved": ["Support Agent Coworker", "Customer Identification & Merge"],
  "messages": [
    {"role": "user", "content": "...", "agent": null},
    {
      "role": "assistant",
      "agent": "general",
      "content": "",
      "tool_calls": [
        {"id": "1", "name": "route_to_agent", "arguments": {"agent_name": "contact", "query": "..."}}
      ]
    },
    {"role": "tool", "agent": "general", "name": "route_to_agent", "content": "{...}"},
    {
      "role": "assistant",
      "agent": "contact",
      "content": null,
      "tool_calls": [
        {"id": "2", "name": "stage_contact_draft", "arguments": {"mode": "create", "nextField": "firstName"}}
      ]
    },
    {"role": "tool", "agent": "contact", "name": "stage_contact_draft", "content": "{...}"},
    {"role": "assistant", "agent": "contact", "content": "What is the contact's first name?"}
  ],
  "routing": [
    {"from": "general", "to": "contact", "query": "..."}
  ],
  "labels": {
    "routing": "correct",
    "tool_use": "correct",
    "workflow": "correct",
    "final_response": "good"
  }
}
```

---

## 9. Sampling guidance

Prioritize:

1. Successful multi-hop coworker tasks (route + tools + final answer)
2. Full contact/queue create workflows (stage → ask → confirm → mutate)
3. Correct refusals (missing confirmation, unauthorized tool, insufficient data)
4. Recovery after tool errors
5. Analytics Path O vs Path S distinctions
6. Monitoring callback + presence/logout id-correct mutations
7. Lola booking/service validation + OTP/ticket paths
8. Human-corrected bad traces (gold revisions)

Avoid overweighting:

- Pure chitchat with no tools
- Duplicate “navigate to X” only
- Broken traces with missing tool results after `tool_calls`

---

## 10. Architecture note for future collection

Current Contact Center coworker (approx. L3 executors only):

```text
Surface start agent → (optional route_to_agent) → specialist → MCP tools
```

Target Contact Center chat architecture:

```text
L1 Contact Center Super Agent
  → L2 Domain Agent (Omnichannel | Interaction Ops | Agent Assist | WFM | Performance)
    → L3 Executor → MCP tools
```

API/cron remain direct LLM (e.g. Interaction Recovery / Interaction Quality).

When 3-layer lands, keep the same episode schema and add:

- `layer`: `super` | `domain` | `executor`
- `cc_agent_name` / `parent_agent_id` for child calls
- `product_spoke`: always `ai_contact_center` for this corpus

---

## 11. Source code map

| Area | Path |
|---|---|
| Contact Center target MAS | `docs/WORKTUAL_MULTI_AGENT_ARCHITECTURE.md` (§6) |
| Agent definitions | `apps/nlp/src/app/agents/definitions.py` |
| Coworker factory | `apps/nlp/src/app/agents/coworker/__init__.py` |
| Router / handoff | `apps/nlp/src/app/runtime/router.py` |
| Agent loop | `apps/nlp/src/app/runtime/agent.py` |
| MCP registry + servers | `apps/nlp/src/app/mcp/registry.py`, `apps/nlp/src/app/mcp/servers/*` |
| Copilot API | `apps/nlp/src/app/api/copilot.py` |
| Support bot API | `apps/nlp/src/app/api/bot.py` |
| Lola multi-agent | `apps/nlp/src/app/agents/custom_lola_worktual/` |
| Sentiment | `apps/nlp/src/app/agents/sentiment_agent.py` |
| Proactive | `apps/nlp/src/app/api/proactive.py` |
| Agent prompts (behavior source of truth) | `apps/nlp/src/app/prompts/*` |

---

## 12. Checklist for FT data pipeline owners

- [ ] Tag every episode with `product_spoke=ai_contact_center` and `cc_agent_name`
- [ ] Export coworker episodes with agent switches and tool traces
- [ ] Export full contact/queue draft workflows (not only final create)
- [ ] Export Lola episodes with Sales/Booking/Service attribution
- [ ] Export support_bot (AI Support Agent) tool traces separately
- [ ] Keep sentiment/proactive as Interaction Quality / Recovery corpora
- [ ] Redact PII/secrets before leaving production network
- [ ] Store prompt/agent versions on every episode
- [ ] Label routing + tool + workflow + final answer quality
- [ ] Reject traces missing tool results after tool_calls
- [ ] Track surface/role because they change allowed tools

---

**Document owner:** NLP platform  
**Consumers:** LLM fine-tuning team, conversation data engineering  
**Related:** `docs/WORKTUAL_MULTI_AGENT_ARCHITECTURE.md` (Contact Center §6)  
**Related skill:** `.cursor/skills/build-nlp-agents/SKILL.md`
