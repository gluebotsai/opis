# Worktual agents — simple working guide

This page explains **what every agent does**, in plain language.

There are **two families** of AI in Ticketing:

| Family | When it runs | Where you see it |
|--------|--------------|------------------|
| **Chat co-worker** | You type in chat | Chat panel |
| **Proactive agents** | A ticket event or a timer fires (you did not ask in chat) | Approvals, ticket summary, bell notifications |

They never replace each other. Chat helps you do work. Proactive agents **watch the system** and suggest or act.

A safety layer called **ASGA** sits after every proactive proposal. It decides:

1. **Run now** (autonomous)  
2. **Ask a human to Confirm** (semi-active)  
3. **Only recommend** (proactive advice — no change until someone accepts)  
4. **Reject** (do nothing)

Express + Postgres still own all real writes and permissions.

---

## Three ways proactive agents work

### 1. Autonomous — runs by itself

The agent is confident and the action is safe (or specially allowed).  
**No Approvals Confirm.** The change or notification happens automatically.

Examples: ticket AI summary updates, staff bell ping, silent learning of routing weights.

### 2. Semi-active — proposes, human must Confirm

The agent wants to **change something important** (close ticket, send customer reply, escalate, assign).  
You see a card on **Approvals**. Nothing mutates until someone clicks **Confirm** (or Send / Reject).

### 3. Proactive (recommend only) — advice, no auto-change

The agent notices something useful (duplicate ticket, KB tip, workload imbalance, insights).  
It writes a **recommendation** on Approvals. It does **not** update the ticket by itself. A person decides what to do.

> Low confidence almost always becomes a **recommendation**, even if the agent could have acted.

```text
Event or timer
    → Agent thinks (LLM + tools)
    → ASGA safety gate
         ├─ Autonomous  → apply now
         ├─ Semi-active → Approvals Confirm
         ├─ Recommend   → Approvals Recommendations
         └─ Reject      → nothing
```

---

## Quick map — every proactive agent

| Agent (full name) | Code | Mode (usual) | One-line job |
|-------------------|------|--------------|--------------|
| Ticket Creation & Capture | TCAA | Semi-active | Turn inbound mail/chat/widget into a ticket proposal |
| Deflection & Self-Service | DSSA | Autonomous / recommend | Answer simple how-tos from KB; skip ticket if confident |
| Classification & Prioritization | ICPA | Recommend / semi-active | Set category & priority on new tickets |
| Intelligent Routing | ITRA | Semi-active / recommend | Suggest who / which queue should own the ticket |
| Resolution Knowledge | RKAA | Recommend | Point staff at useful KB / past tickets |
| Similar Ticket Detection | STDA | Recommend | Flag duplicates and past solutions (notes, macros, KB) |
| Autonomous Resolution | ARA | Semi-active | Close or reopen when the customer says it’s fixed / broken |
| Ticket Summary Assistant | TSAA | Autonomous | Keep a rolling AI summary on the ticket |
| Customer Response Drafting | CRDA | Semi-active | Draft a reply to the customer (never auto-send) |
| Resolution Quality | RQA | Semi-active / recommend | Check Resolved tickets for a real close-out note |
| SLA & Escalation | SEMA | Recommend / semi-active | Warn on SLA risk; escalate only after Confirm |
| Personalized Notifications | PNA | Autonomous | Ping staff bell when prefs allow (not Approvals) |
| Workload Optimization | WLOA | Recommend | Suggest load balancing (does not reassign) |
| Insights & Analytics | TIAA | Recommend | Org metrics insights from real data / semantic layer |
| Root Cause & Learning | RCAA | Autonomous | Learn recurring patterns into routing weights (silent) |

**ASGA** is not an agent — it is the gate that chooses autonomous / Confirm / recommend / reject.

---

## Proactive agents in detail

### Autonomous

#### Ticket Summary Assistant (TSAA)
- **Does:** Rewrites the ticket’s AI summary as the thread grows (create, notes, replies, status changes).
- **You see:** Summary on the ticket (Description area). **Not** on Approvals.
- **Does not:** Change status, assignee, or invent facts.

#### Personalized Notifications Agent (PNA)
- **Does:** Sends staff inbox / bell notifications for assign, update, SLA, etc., if preferences allow.
- **You see:** Header bell. **Not** Confirm/Reject on Approvals.
- **Does not:** Change the ticket.

#### Root Cause & Learning Agent (RCAA)
- **Does:** On a schedule (~hourly), studies outcomes and updates org **routing weights** for ITRA.
- **You see:** Nothing on Approvals (silent learning).
- **Does not:** Create or edit tickets.

#### Deflection & Self-Service Agent (DSSA) — when confident
- **Does:** On inbound messages, checks KB; if the customer can self-serve, deflects and **skips** creating a ticket.
- **You see:** Deflection outcome on intake; may also leave a recommendation if unsure.
- **Does not:** Silently invent answers without KB grounding.

---

### Semi-active (needs human Confirm)

#### Ticket Creation & Capture Agent (TCAA)
- **Does:** Reads inbound text, finds customer if possible, proposes creating a ticket.
- **Trigger:** Inbound channels (not the staff “Create ticket” form).
- **Human:** Confirm before create when gated as high-risk / approval path.

#### Autonomous Resolution Agent (ARA)
- **Does:** When a customer replies (portal, email, or portal bot), decides close → **Resolved** or reopen → **Reopened**.
- **Human:** Always Confirm before status change.
- **Does not:** Use fixed keyword lists; LLM judges the message.

#### Customer Response Drafting Agent (CRDA)
- **Does:** Drafts a reply after the customer writes back.
- **Human:** Review / edit → **Send reply** (or Reject). Never auto-sends to the customer.

#### Resolution Quality Agent (RQA)
- **Does:** When a ticket is marked **Resolved**, checks whether staff documented the fix. Weak/empty notes → recommendation or an internal closing-note draft.
- **Trigger:** `ticket.updated` only when status becomes Resolved. Not a timer. Not other field updates.
- **Human:** Confirm before posting the internal note. Ticket stays Resolved.
- **Does not:** Reopen, treat `ai_summary` as enough documentation, or auto-write notes.
- **Off switch:** `PROACTIVE_RQA=0`.

#### Intelligent Routing Agent (ITRA)
- **Does:** Suggests assignee / queue using roster, workload, and learned weights.
- **Human:** Auto-assign is treated as sensitive — Confirm when it would change ownership.

#### SLA & Escalation Agent (SEMA)
- **Does:** Notices tickets near due / overdue; can propose escalate / reassign.
- **Human:** Escalate waits for Confirm. Quiet when tickets are fine.
- **Note:** Reminder/breach **emails** near due time are handled by Express SLA sweep, not by SEMA alone.

#### Classification & Prioritization Agent (ICPA)
- **Does:** Proposes category / priority on `ticket.created`.
- **Human:** Low confidence → recommendation; stronger / riskier updates may need Confirm.

---

### Proactive recommendations only

#### Similar Ticket Detection Agent (STDA)
- **Does:** On new tickets, finds likely duplicates and points at solutions already used (notes, macros, KB).
- **Does not:** Merge tickets by itself.

#### Resolution Knowledge Agent (RKAA)
- **Does:** Stores knowledge recommendations for the ticket (KB / similar work).
- **Does not:** Paste articles into chat by default.

#### Workload Optimization Agent (WLOA)
- **Does:** On a ~5 minute schedule, recommends balancing load across people/queues.
- **Does not:** Reassign tickets itself.

#### Insights & Analytics Agent (TIAA)
- **Does:** On a ~10 minute schedule (or on demand), summarizes real metrics (semantic layer when available).
- **Does not:** Invent KPIs when data is empty.

---

## Chat co-worker (when you talk to it)

This is **interactive**: you speak, it replies. It is not the proactive runtime.

| Specialist | Helps with |
|------------|------------|
| Tickets | Create / update / search tickets, drafts, confirm writes |
| Teams / Queues | Create teams, add members, queue work |
| Knowledge Base | Draft / find articles |
| Customers | Look up customers |
| General | Greetings, navigation, light help |

**How a chat turn works (simple):**

```text
You type
  → Express (auth)
  → LangGraph on :8012
  → Workflow Manager (if a form/draft is open)
     or Intent → Policy → Specialist
  → Tools (same APIs as the UI)
  → LLM reply painted in chat
```

High-risk chat writes still use confirm chips / tools — Gemma never writes the database directly.

---

## When does each proactive agent wake up?

| Trigger | Typical agents |
|---------|----------------|
| Inbound message (email / chat / widget) | DSSA, TCAA |
| Ticket created | ICPA, ITRA, RKAA, STDA, TSAA, PNA |
| Ticket updated / note / customer reply | TSAA, CRDA, ARA, SEMA, PNA |
| Ticket updated to Resolved | RQA |
| Portal bot turn | ARA (on demand) |
| ~1 min schedule | SEMA |
| ~5 min schedule | WLOA |
| ~8s debounce / lifecycle | TSAA |
| ~10 min schedule | TIAA |
| ~1 hour schedule | RCAA |

---

## How to check they are working

1. Keep **Ticketing** (`:3000`) and **agents** (`:8012`) running.  
2. Open **Approvals** as admin → Refresh.  
3. Autonomous items: look at **ticket summary** and the **bell**, not only Approvals.  
4. Semi-active: Confirm / Reject cards.  
5. Recommend-only: Recommendations list (no silent ticket edit).

---

## Related docs

- End-to-end create → resolve (autonomous vs semi-autonomous): [agents-ticket-lifecycle.md](./agents-ticket-lifecycle.md)  
- Detailed proactive scenarios: [proactive-agents.md](./proactive-agents.md)  
- Chat architecture (deeper): [agents.md](./agents.md)  
- Ownership freeze: [architecture-freeze.md](./architecture-freeze.md)  
