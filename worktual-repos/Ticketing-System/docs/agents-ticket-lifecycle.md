# Agents end-to-end: ticket creation to resolution

This document traces **every Worktual AI agent** across a ticket’s life — from inbound capture through triage, work, customer replies, SLA, and resolve/reopen — and states whether each step is **autonomous**, **semi-autonomous**, or **recommend-only**.

It is the lifecycle companion to:

- [agents-working-guide.md](./agents-working-guide.md) — what each agent does (plain language)
- [proactive-agents.md](./proactive-agents.md) — per-agent scenarios and Approvals behaviour
- [agents.md](./agents.md) — chat co-worker architecture (LangGraph)

Product docs also use **semi-active** for the same idea as **semi-autonomous**: the agent proposes a write; a human must Confirm (or Send / Reject) before Express mutates Postgres.

---

## 1. Two AI families (they never replace each other)

| Family | When it runs | Who starts it | Where you see it |
|--------|--------------|---------------|------------------|
| **Chat co-worker** | Staff or portal customer types in chat | A person | Chat panel |
| **Proactive agents** | An event or a timer fires | The system | Approvals, ticket AI summary, header bell |

Chat helps a person **do** work (create, update, search, escalate). Proactive agents **watch** tickets and org data, then suggest or act. Proactive code lives in `ai-agents/app/proactive/` and must not be imported by chat (`workflow_manager`, ticket/admin specialists).

**Invariant:** Gemma never writes SQL. Express owns RBAC, validation, and every database mutation. Confirm on Approvals runs the **same catalog tools** as chat.

---

## 2. Three operating modes

ASGA (Agent Safety Gate — **not** an agent) sits after every proactive proposal and chooses one of four outcomes. Those map to three product modes plus reject:

| Mode | ASGA decision | What happens | Human required? |
|------|---------------|--------------|-----------------|
| **Autonomous** | `execute` | Tool runs immediately via Express | No |
| **Semi-autonomous** | `approve` | Card on **Approvals → pending**. Nothing mutates until Confirm / Send / Reject | Yes — Confirm (or Send) |
| **Recommend-only** | `recommend` | Card on **Approvals → recommendations**. Ticket is not updated | Yes — a person decides what to do next |
| **Reject** | `reject` | Audit only; no UI card; no write | — |

```text
Event or timer
    → Named agent (Gemma + allowed tools)
    → ASGA safety gate
         ├─ Autonomous      → apply now (Express → Postgres)
         ├─ Semi-autonomous → Approvals Confirm / Send
         ├─ Recommend-only  → Approvals Recommendations
         └─ Reject          → nothing
```

### How ASGA chooses

1. **Undeclared tool** or **already handled** → reject.
2. **Special autonomous allowlists** (never Approvals):
   - PNA `send_staff_notification` → execute (bell inbox)
   - TSAA `update_ticket` that writes **only** `ai_summary` → execute
   - RCAA learning blob → execute (silent; no Approvals card)
3. **Low confidence** (below that agent’s threshold) → recommend (PNA / TSAA / RCAA reject instead of recommending).
4. **Output type is recommendation, or no tool** → recommend.
5. **High-risk** → semi-autonomous (Approvals pending):
   - Tools: `escalate_ticket`, `auto_assign_ticket`
   - Status args: `closed` / `resolved` / `solved`
   - Public customer note (`add_ticket_note` + `visibility=public`)
   - ITRA stealing an existing assignee
   - Agent set `risk_level=high` (ARA, CRDA always)
6. Otherwise → **autonomous execute**.

Low confidence almost always becomes a **recommendation**, even if the agent could have acted.

---

## 3. Ticket statuses the lifecycle uses

| Status | Terminal? | Meaning in this flow |
|--------|-----------|----------------------|
| **Open** | No | Newly created / not yet in progress |
| **Pending** | No | Being worked (UI: In Progress) |
| **Overdue** | No | Past SLA `due_at`, still unresolved (Express sweep, not an agent) |
| **Resolved** | **Yes** | Finished |
| **Reopened** | No | Was resolved, then opened again |

Staff can **Reopen** a Resolved ticket in the console without Approvals. ARA proposing the same change is always semi-autonomous.

---

## 4. End-to-end lifecycle

Read this as one ticket moving left to right. Agents listed under each stage are the ones that **typically wake up**. Org-wide scheduled agents (WLOA, TIAA, RCAA) run in parallel the whole time — see [§6](#6-org-level-scheduled-agents-parallel-to-any-ticket).

```text
 INBOUND / CREATE          TRIAGE              WORK                RESOLVE
 ───────────────           ──────              ────                ───────
 inbound.message      ticket.created      notes / replies     close / reopen
        │                    │                  │                    │
   ┌────┴────┐          ┌────┴────┐        ┌────┴────┐          ┌────┴────┐
   │ DSSA    │          │ ICPA    │        │ TSAA    │          │ ARA     │
   │ TCAA    │          │ ITRA    │        │ CRDA    │          │ staff   │
   │ chat /  │          │ RKAA    │        │ SEMA    │          │ chat    │
   │ form /  │          │ STDA    │        │ PNA     │          │ console │
   │ portal  │          │ TSAA    │        │ TSAA    │          │ TSAA    │
   └─────────┘          │ PNA     │        └─────────┘          │ PNA     │
                        └─────────┘                             └─────────┘
```

---

### Stage 0 — Before a ticket exists (inbound only)

**Who starts it:** Inbound email, chat, or widget (`inbound.message`).  
**Does not run** from the staff **Create Ticket** form, staff chat create-ticket, portal create, or Intake API — those already produce a ticket.

Runtime order is fixed: **DSSA first**. If DSSA is confident the customer can self-serve, **TCAA is skipped** and no ticket is created.

| Agent | Job | Mode | Human sees |
|-------|-----|------|------------|
| **DSSA** — Deflection & Self-Service | Search KB. If the how-to is enough, deflect and skip create | **Autonomous skip** when confident (`deflect=true` and confidence ≥ 0.75). Unsure → **recommend-only** and TCAA still runs | Deflection outcome on intake; may leave an Approvals recommendation. Never invents steps not in KB |
| **TCAA** — Ticket Creation & Capture | Read inbound text, find customer if possible, propose `create_ticket` | **Semi-autonomous** when ASGA treats create as gated; **autonomous execute** when confidence ≥ 0.55 and the action is not high-risk | Approvals pending (Confirm) or a created ticket. **Not** the Create Ticket screen |

**Chat co-worker (parallel path, not this event):** Staff type “create ticket” → LangGraph collects customer name, email/phone, issue → `enrich_ticket` fills subject/priority/description → **human confirms in chat** → `create_ticket` → Express `POST /api/tickets`. Portal chat collects **issue only** (`portal_create_ticket`). That confirm is **semi-autonomous chat**, not Approvals.

After a ticket row exists, Express emits `ticket.created` and Stage 1 starts — regardless of which channel created it.

---

### Stage 1 — Ticket created (the post-create swarm)

**Trigger:** `ticket.created` from console, portal intake, API/email intake, or a confirmed TCAA create.

These agents run **in parallel** on the same event. None of them wait for chat.

| Agent | Job | Mode | What mutates |
|-------|-----|------|--------------|
| **ICPA** — Classification & Prioritization | Propose category, priority, optional queue from ticket content | **Autonomous** `update_ticket` when confidence ≥ 0.72. **Recommend-only** when unsure | Priority / category / queue — not status |
| **ITRA** — Intelligent Routing | Suggest assignee/queue from roster, workload, and RCAA routing weights | **Semi-autonomous** when assigning would steal an existing owner, or when using `auto_assign_ticket`. **Recommend-only** if no tool / low confidence. May **autonomous**-assign an unassigned ticket when confidence is high and risk is low | Assignee / queue. Does not invent people |
| **RKAA** — Resolution Knowledge | Retrieve similar KB / past tickets; store a recommendation | **Recommend-only** | Nothing on the ticket. Chat can later read the rec via a tool; articles are not pasted into chat |
| **STDA** — Similar Ticket Detection | Compare against other tickets; cite notes, macros, KB from likely duplicates | **Recommend-only**. Merge is always a human decision | Nothing. No merge tool |
| **TSAA** — Ticket Summary Assistant | Write the opening rolling summary | **Autonomous** (`tickets.ai_summary` only) | Summary on ticket detail **Description**. Original request is kept separate. **Not** on Approvals |
| **PNA** — Personalized Notifications | Ping assignee / org admins if prefs allow | **Autonomous** | Header bell only. Deduped per org + event + ticket + user. Never Approvals Confirm/Reject |

**Staff still own the ticket.** Classification and routing are assists. Auto-assign that would change ownership stays behind Confirm.

---

### Stage 2 — Work in progress (staff investigation)

Humans work the ticket in the console or via chat: notes, status **Pending**, priority, assignee, escalate to a resolver.

| What happens | Mode | Agents involved |
|--------------|------|-----------------|
| Staff (or chat) updates fields, adds an **internal** note, escalates | Human / **semi-autonomous chat** (high-risk chat writes use confirm chips) | Express emits `ticket.updated`, `ticket.comment_added`, `ticket.escalated` |
| Rolling summary rewrite | **Autonomous** | **TSAA** (debounced ~8s mid-life; create and on-demand always run). A PATCH that only writes `ai_summary` does **not** re-trigger TSAA |
| Staff bell for assignment / update / comment | **Autonomous** | **PNA** (prefs + dedupe) |
| SLA near due / overdue noticed | **Recommend-only** warning; escalate/reassign is **semi-autonomous** | **SEMA** — see Stage 4 |
| Chat looks up KB / similar tickets | Interactive | Chat tools; may read RKAA recs already stored |

TSAA never changes status or assignee and never invents facts or next steps (those belong to RKAA / ARA).

---

### Stage 3 — Customer replies (any customer channel)

**Triggers:**

- `customer.replied` — support portal / sub-portal Send reply, inbound email thread reply, staff-app customer note
- `on_demand.ara` — after every authenticated **portal bot** turn (ARA only)

| Agent | Job | Mode | Human action |
|-------|-----|------|--------------|
| **ARA** — Autonomous Resolution | LLM judges whether the customer said the issue is fixed or still broken. Close → **Resolved**. Reopen → **Reopened**. Silence if vague (“thanks”, how-to chat) | **Always semi-autonomous**. Always high-risk. No keyword lists | Confirm on Approvals before status changes. Portal bot: “reopen that ticket” after mentioning `#9` must target **#9**, not a different open ticket |
| **CRDA** — Customer Response Drafting | Draft a public reply | **Always semi-autonomous**. Never auto-send | Open the CRDA card → review/edit in the reply panel → **Send reply** or Reject. Edited text is what is posted. Email-channel tickets also email the customer; portal / web / portal-bot skip reply email (customer sees the public note) |
| **TSAA** | Rewrite summary from the new reply | **Autonomous** | — |
| **PNA** | Notify staff if prefs allow | **Autonomous** | Bell, not Approvals |

ARA’s name means it **decides** close/reopen without a staff chat command. It does **not** mean it writes the status by itself.

---

### Stage 4 — SLA risk (while the ticket is still open)

Two separate systems; only one is an agent.

| System | Job | Mode |
|--------|-----|------|
| **SEMA** — SLA & Escalation Agent | On `ticket.updated`, `ticket.sla_at_risk`, or ~1 min `schedule.sema`: if a ticket is actually near due / overdue, write **which ticket, time left, and what to do**. Quiet when tickets are fine. A bare “SLA check” is not a recommendation | **Recommend-only** for warnings. **Semi-autonomous** for `escalate_ticket` / reassign — Confirm runs as the admin who clicked; if the tool fails, Approvals keeps the card |
| **Express SLA sweep** (`ui-backend/src/server/slaSweep.ts`) | ~1 hour before `due_at`: email assignee and resolver (`sla_reminder_1h`). After deadline, still unresolved: status → **Overdue** and org-admin breach email (`sla_breach_admin`). Resolved tickets skip both | **Autonomous Express** — not an agent, not Approvals |

---

### Stage 5 — Resolution

A ticket becomes **Resolved** in one of three ways:

| Path | Who decides | Mode |
|------|-------------|------|
| Staff console (status change) or chat `update_ticket` | Staff (chat confirm if the specialist required it) | Human / **semi-autonomous chat** |
| **ARA** after customer said it is fixed | LLM proposes `close_ticket` | **Semi-autonomous** — Confirm required |
| Org automation rules (Express if/then on `ticket.updated`) | Configured rule | Not an AI agent |

On resolve: `resolved_at` is set; TSAA rewrites the summary; PNA may ping; customer resolve mail stays on the existing Express path (not SEMA).

---

### Stage 6 — After resolve (reopen, learning, quiet)

| Event | Agent / system | Mode |
|-------|----------------|------|
| Customer says it is still broken (`customer.replied` / portal bot) | **ARA** proposes **Reopened** | **Semi-autonomous** (Confirm). Confirm/manual update clears `resolved_at` and refreshes staff + portal progress |
| Staff clicks **Reopen** on a Resolved ticket | Console | Human — same status, **no Approvals** |
| ~hourly org learning | **RCAA** | **Autonomous silent** — updates routing weights (`skill_weights` + `recurring_issues`) for the next ITRA run. No ticket create/update. **Does not** appear on Approvals |
| TSAA after reopen / field change | **TSAA** | **Autonomous** summary rewrite |

---

## 5. Create-path matrix (how the ticket got here)

| Create path | AI before create | After `ticket.created` |
|-------------|------------------|------------------------|
| Staff **Create Ticket** form | None (TCAA does not run) | Full Stage 1 swarm |
| Staff **chat** create-ticket | LangGraph collect → enrich → **chat confirm** | Full Stage 1 swarm |
| Customer **portal** form / portal chat | Portal chat: issue only | Full Stage 1 swarm |
| **Intake API** / widget / email that already creates | Channel-specific | Full Stage 1 swarm |
| Raw **inbound.message** (mail/chat/widget capture) | **DSSA** then **TCAA** | Stage 1 only if a ticket was created |

---

## 6. Org-level scheduled agents (parallel to any ticket)

These do not belong to a single ticket’s status. They run while the agents process (`:8012`) is up.

| Agent | Timer | Mode | Effect on a live ticket |
|-------|-------|------|-------------------------|
| **SEMA** | ~1 min (`schedule.sema`) plus ticket/SLA events | Recommend / semi-autonomous | Can warn or propose escalate for **that** ticket |
| **WLOA** — Workload Optimization | ~5 min | **Recommend-only** | Advice to balance people/queues. **Never reassigns** |
| **TIAA** — Insights & Analytics | ~10 min or `on_demand.insights` | **Recommend-only** | Org metrics via `ask_semantic_layer` (fallback Express analytics). Never invents KPIs |
| **TSAA** | On create + ticket events (comment/update/escalate/etc.); ~8s debounce | **Autonomous** | Summary only |
| **RCAA** — Root Cause & Learning | ~1 hour | **Autonomous silent** | Routing weights only; ITRA reads them on the **next** new ticket |

---

## 7. Chat co-worker across the same lifecycle

Chat is **interactive** and **semi-autonomous on writes**: you speak, LangGraph keeps state, the specialist asks or calls a tool, Express mutates.

```text
You type
  → Express (auth)
  → LangGraph on :8012
  → Workflow Manager (if a form/draft is open)
     or Intent → Policy → Specialist
  → Tools (same APIs as the UI)
  → LLM reply in chat
```

| Lifecycle need | Chat specialist | Notes |
|----------------|-----------------|-------|
| Create ticket | Tickets | Required: name, contact, issue. Park/resume on side quests (“show my open tickets”) without re-asking filled fields |
| Search / list / open | Tickets | Live rows from Express; no invented counts |
| Update status, priority, assignee | Tickets | High-risk writes use confirm chips |
| Escalate / reassign | Tickets | `escalate_ticket` keeps L1, sets resolver |
| Internal note | Tickets | Public customer send is CRDA’s job on the proactive path |
| Teams / queues | Teams | Create team, members, queues |
| KB draft / find | Knowledge Base | Does not replace RKAA’s stored recs |
| Customer lookup | Customers | Directory bind during create-ticket |

Proactive agents must not be folded into this graph. Chat may **read** RKAA recommendations via a tool; it does not become the classifier, router, or SLA cron.

---

## 8. Master map — every proactive agent by mode

| Agent | Code | Usual mode | Ticket-lifecycle stage | Mutates tickets? |
|-------|------|------------|------------------------|------------------|
| Deflection & Self-Service | DSSA | Autonomous skip / recommend | 0 — inbound | No (skips create) |
| Ticket Creation & Capture | TCAA | Semi-autonomous (can execute if allowed) | 0 — inbound | Yes — create |
| Classification & Prioritization | ICPA | Autonomous if confident; else recommend / Confirm | 1 — created | Yes — fields |
| Intelligent Routing | ITRA | Semi-autonomous / recommend | 1 — created | Yes — assignee/queue |
| Resolution Knowledge | RKAA | Recommend-only | 1 — created | No |
| Similar Ticket Detection | STDA | Recommend-only | 1 — created | No |
| Ticket Summary Assistant | TSAA | **Autonomous** | 1 → 6 (entire life) | Yes — `ai_summary` only |
| Personalized Notifications | PNA | **Autonomous** | 1 → 6 | No (bell only) |
| Customer Response Drafting | CRDA | **Semi-autonomous** | 3 — customer reply | Yes — public note after Send |
| Autonomous Resolution | ARA | **Semi-autonomous** | 3 and 5–6 | Yes — status after Confirm |
| Resolution Quality | RQA | **Semi-autonomous** / recommend | 6 — just Resolved | Yes — internal note after Confirm |
| SLA & Escalation | SEMA | Recommend / **semi-autonomous** | 2 and 4 | Yes — escalate only after Confirm |
| Workload Optimization | WLOA | Recommend-only | Parallel | No |
| Insights & Analytics | TIAA | Recommend-only | Parallel | No |
| Root Cause & Learning | RCAA | **Autonomous silent** | After outcomes / hourly | No tickets; yes routing weights |

**ASGA** is the gate that chooses autonomous / Confirm / recommend / reject. UI names are the **full names**, not the short codes.

---

## 9. Autonomous vs semi-autonomous — quick contrast

**Autonomous (no Approvals Confirm)**

- TSAA rolling summary
- PNA staff bell (prefs + dedupe)
- RCAA routing-weight learning
- DSSA skipping ticket create when KB deflection is confident
- ICPA field updates when confidence is high and risk is low
- Express SLA reminder/breach emails and Overdue status (not an agent)

**Semi-autonomous (human Confirm / Send before the write)**

- TCAA creating a ticket when gated
- ITRA assignment that would change ownership
- ARA close → Resolved or reopen → Reopened
- CRDA sending a customer-facing reply
- RQA internal closing note after resolve
- SEMA escalate / reassign
- Chat co-worker high-risk writes (create ticket confirm, escalate, etc.)

**Recommend-only (advice; ticket unchanged until a person acts)**

- STDA duplicates and past solutions
- RKAA KB / similar-ticket pointers
- WLOA load-balancing
- TIAA org insights
- SEMA SLA warnings that do not escalate
- RQA “add a resolution note” when it has no grounded draft
- Any proposal that falls below its confidence threshold (except PNA/TSAA/RCAA, which reject)

---

## 10. Shared technical path

```text
Express emits event (or schedule ticks)
  → outbox → agents :8012
  → named module in ai-agents/app/proactive/
  → Proposal (tool + args + confidence + risk)
  → ASGA
  → recommendation | pending approval | execute | reject
  → Postgres via Express (RBAC)
  → Approvals UI / ticket summary / bell
```

Typical Express events:

| Event | Typical agents |
|-------|----------------|
| `inbound.message` | DSSA, TCAA |
| `ticket.created` | ICPA, ITRA, RKAA, STDA, TSAA, PNA |
| `ticket.updated` / `ticket.comment_added` / `ticket.escalated` | TSAA, SEMA, PNA |
| `customer.replied` | ARA, CRDA, TSAA, PNA |
| `on_demand.ara` | ARA |
| `ticket.sla_at_risk` | SEMA, TSAA, PNA |
| `schedule.sema` / `wloa` / `tiaa` / `rcaa` | Matching agent |

---

## 11. How to verify a full cycle

1. Keep Ticketing (`:3000`) and agents (`:8012`) running. Open **Approvals** as admin.
2. **Inbound how-to** that matches KB → DSSA deflection, **no** new ticket.
3. **Inbound incident** (“VPN down all morning”) → TCAA proposal/create → Stage 1 recs (ICPA/ITRA/RKAA/STDA) + TSAA summary + PNA bell.
4. Add a staff note → TSAA rewrites; Approvals has **no** TSAA card.
5. Customer replies “still broken” → CRDA pending draft (Send, never auto) + ARA silent unless they asked to close.
6. Customer replies “close this, it’s fixed” → ARA close card → Confirm → status **Resolved** everywhere.
7. Leave a ticket near `due_at` → SEMA names the ticket and time left; Express may email 1h before due / mark Overdue after.
8. After enough history, wait ~1 hour → RCAA weights change for the next ITRA run; no Approvals card.

---

## Related

- Simple agent guide: [agents-working-guide.md](./agents-working-guide.md)
- Per-agent scenarios: [proactive-agents.md](./proactive-agents.md)
- Chat architecture: [agents.md](./agents.md)
- Target ticket flow (roles, not AI modes): [ticketing_flow.md](./ticketing_flow.md)
- Ownership freeze: [architecture-freeze.md](./architecture-freeze.md)
- Code: `ai-agents/app/proactive/`
- Tests: `ai-agents/tests/test_proactive_agents.py`
- UI: `ui-frontend/src/components/ApprovalsView.tsx`
