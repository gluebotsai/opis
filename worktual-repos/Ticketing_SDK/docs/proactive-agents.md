# Proactive agents

Proactive agents are a **second category** of Worktual AI. They are **not chat**.

| | Chat co-worker | Proactive agents |
|---|---|---|
| When they run | You type a message | An event or a timer fires |
| What they do | Guide workflows, answer, run tools you asked for | Watch tickets and org data, then suggest or request Confirm |
| Where you see them | Chat panel | **Approvals** (pending + recommendations) |

They exist so the product can **notice work without waiting for a chat command**: classify a new ticket, spot a duplicate, draft a customer reply, warn on SLA, suggest load balancing. Chat stays frozen. Proactive code lives in `ai-agents/app/proactive/` and must not be imported by chat (`workflow_manager`, ticket/admin specialists).

**Safety (ASGA)** sits after every agent: unsure → recommendation; high-risk → Approvals queue; only allowed catalog tools may run; Express still owns RBAC and the database. Confirm on Approvals runs the **same tools** as chat.

**How to check:** keep agents on `:8012`, open **Approvals** as admin, Refresh after each scenario. Names in the UI are the full names below, not short codes (WLOA, TCAA, …).

---

## Shared path

```text
Event or schedule
  → named agent (Gemma + tools)
  → ASGA gate
  → recommendation | pending approval | execute | reject
  → Postgres (via Express)
  → Approvals UI
```

Typical UI events Express already emits:

- Create ticket → `ticket.created`
- Update ticket → `ticket.updated`
- Staff note → `ticket.comment_added`
- Customer reply (portal note, email append, staff-app customer note) → `customer.replied`
- Portal chat (ARA only) → `on_demand.ara`

Inbound email/chat/widget (`inbound.message`) and timed jobs (`schedule.sema`, `schedule.wloa`, `schedule.tiaa`, `schedule.rcaa`) are separate. Schedules run while the agents process is up (SLA ~1 min, workload ~5 min, insights ~10 min, root cause ~1 hour).

---

## 1. Ticket Creation & Capture Agent

**Why it exists:** Inbound mail, chat, or widget should become a ticket without a human copying the message.

**Use:** Read the inbound text, find the customer if possible, propose `create_ticket`.

**Scenario:** Inbound: “VPN has been down all morning, I cannot work.” Working if a ticket is proposed/created. This does **not** run from the Create Ticket screen.

---

## 2. Deflection & Self-Service Agent

**Why it exists:** Not every inbound message needs a ticket. Simple how-to questions should hit the knowledge base first.

**Use:** Search KB/similar tickets. If it is confident the customer can self-serve, recommend deflection and **skip** ticket creation.

**Scenario:** Inbound: “How do I reset my Wi‑Fi?” and that article exists in KB. Working if you get a deflection rec and no new ticket.

---

## 3. Classification & Prioritization Agent

**Why it exists:** New tickets should get a category and priority from content, not sit as untriaged.

**Use:** On `ticket.created`, read the ticket and propose `update_ticket` (priority/category). Low confidence stays a recommendation.

**Scenario:** Create ticket “Billing invoice wrong amount.” Working if Approvals shows a rec/action about category or priority for that ticket.

---

## 4. Intelligent Routing Agent

**Why it exists:** The right person should own the ticket using roster, queues, workload, and learned routing weights — not a second hidden assigner.

**Use:** After create (and after classification). Suggest assignee/queue. Auto-assign is treated as sensitive (approval).

**Scenario:** Create any new ticket. Working if you see a rec (or assign approval) about who should own it.

---

## 5. Resolution Knowledge Agent

**Why it exists:** Agents should see relevant KB and past tickets without the chat orchestrator injecting articles into the conversation.

**Use:** On new tickets (or on-demand knowledge), retrieve similar KB/tickets and **store a recommendation**. Chat can later read that via a tool; it is not pasted into chat by default.

**Scenario:** Create a ticket that matches an existing KB article. Working if a rec points at that knowledge.

---

## 6. Similar Ticket Detection Agent

**Why it exists:** Duplicate / repeated work should be visible, and staff should see solutions that already worked. Merge must stay a human decision.

**Use:** On `ticket.created`, compare against other **tickets**. When the LLM flags a duplicate or repeat, the recommendation cites **existing solutions** from similar-ticket **notes**, matching **macros**, and **KB articles**. Recommendation only — no merge tool.

**Scenario:** Open a ticket, resolve it with notes (or have a macro/KB for that issue), then create a second ticket with the same problem. Working if Approvals shows a STDA rec naming the duplicate and pointing at those notes / macros / articles.

---

## 7. Autonomous Resolution Agent

**Why it exists:** When a customer replies that the issue is fixed (or still broken), the ticket status should update without waiting for a staff chat command — but only after LLM judgment and Approvals.

**Use:** On `customer.replied` from **any customer channel** (support portal / sub-portal Send reply, inbound email thread reply, staff-app customer note) and `on_demand.ara` after every authenticated **portal bot** turn. The ARA LLM reads the message (and portal-chat conversation + the customer’s ticket list) and decides `close_ticket` / `reopen_ticket` / silence — including resolving “that ticket” from dialogue, not from a code `#` map. Close → **Resolved**; reopen → **Reopened**. Always **high-risk** → Confirm before mutate. Staff can also click **Reopen** on a Resolved ticket in the console (same status, no Approvals). Confirm/manual update clears `resolved_at` and refreshes staff + portal progress. No keyword lists; no create-time password/unlock playbooks.

**Scenario:** Customer portal reply or email “my ticket is resolved, close this ticket now.” Working if Approvals shows an ARA close proposal and Confirm sets status to **Resolved** everywhere. Portal bot: mention `#9`, then “reopen that ticket” → ARA proposes **#9 → Reopened** (not a different open ticket). Vague “thanks” / how-to chat → no status change.

---

## 8. Ticket Summary Assistant

**Why it exists:** Long threads and multi-channel updates are hard to scan. Staff need a rolling “current state” summary on the ticket itself — not another Approvals card.

**Use (create → close):** Runs from **ticket create** (console, portal intake, API/email intake) through staff notes, customer replies, field updates, auto-assign, escalate, SLA breach/overdue, resolve/reopen, on-demand summarize, and a schedule safety net. Debounced (~8s) mid-life; create and on-demand always run. The LLM rewrites `tickets.ai_summary` using **only** that ticket’s fields + progress + recent notes. Never invents facts; never suggests next steps (RKAA/ARA). PATCH that only writes `ai_summary` does not re-trigger TSAA.

**Where you see it:** Ticket detail **Description** shows the rolling AI summary; **Original request** keeps the source description. Approvals Recommendations do **not** list TSAA.

**Scenario:** Create a ticket → Description gets an opening summary. Add a staff note or portal reply → summary rewrites. Approvals has no TSAA card.

---

## 9. Customer Response Drafting Agent

**Why it exists:** When the customer writes back, staff need a draft quickly — but sending as the org is high-risk.

**Use:** On `customer.replied`. Draft a reply. **Always approval.** Never auto-send. In Approvals, open the CRDA card → review/edit the draft in the reply panel → **Send reply** (or Reject). Edited text is what gets posted as the public note. **Send** also emails the customer when the ticket is email-channel; **portal / web / portal-bot** tickets skip reply email (customer sees the public note in the portal).

**Scenario:** Customer replies “Thanks, still broken.” Working if a **pending approval** shows a draft preview; Review draft opens the editor; Send posts the (possibly edited) public reply.

---

## 10. Resolution Quality Agent

**Why it exists:** Tickets get Resolved with empty notes and no real close-out. TSAA writes `ai_summary`; nobody checks whether the human resolution is complete.

**Use:** Only when a ticket’s status is **updated to Resolved** (`ticket.updated` transition). Reads notes / progress / ticket fields. If the close is documented, stays silent. If not, recommends “add a resolution note” or drafts an **internal** closing note for Approvals Confirm. Never auto-writes. Never reopens. Does **not** run on a timer, on other field updates, or because `ai_summary` exists.

**Scenario:** Mark a ticket Resolved with no staff note. Working if Approvals shows a Resolution Quality Agent card. Confirm posts an internal note; status stays Resolved. Resolve the same kind of ticket **with** a clear fix note → no card.

Disable with `PROACTIVE_RQA=0` for a lean swarm.

---

## 11. SLA & Escalation Agent

**Why it exists:** SLA risk should be noticed from remaining time and ticket state, not a silent cron that escalates by itself.

**Use:** Ticket update, SLA-at-risk event, or ~1 minute schedule. Writes a rec only when a ticket is actually near due / overdue, with **which ticket, time left, and what to do**. A bare “SLA check” is not a recommendation — the agent stays quiet. Escalate/reassign wait for Confirm. **Confirm** runs `escalate_ticket` as the admin who clicked (must succeed before the approval is marked approved); Approvals shows an error and keeps the card if the tool fails.

**Timed SLA email (Express, not SEMA):** About **1 hour before** `due_at`, Express emails the **assignee and resolver** (`sla_reminder_1h`). After the deadline, while still unresolved, status becomes **Overdue** and **org admins** get a breach email (`sla_breach_admin`). Resolved tickets skip both. Customer resolve mail stays the existing path. See `ui-backend/src/server/slaSweep.ts`.

**Scenario:** A ticket with a due time in the next few hours (or already overdue). Working if Approvals shows that ticket and remaining time — not the words “SLA check”. Tickets that are fine produce nothing.

---

## 12. Personalized Notifications Agent

**Why it exists:** Staff should hear about assignment/updates/SLA only if prefs allow, and not get the same ping twice.

**Use:** Ticket created/updated/comment/customer reply/SLA. Hard gate: no notify user, or opt-out → **no proposal**. Notify is **informational** — auto-delivered to the header bell inbox (never Approvals Confirm/Reject). Dedupes per org + event + ticket + user.

**Scenario:** Create or update a ticket that has an assignee. Working if a **bell notification** appears once; repeating the same event should not ping twice. Approvals must not show Confirm/Reject for PNA.

---

## 13. Workload Optimization Agent

**Why it exists:** Managers need load-balancing advice across people and queues without the agent stealing assignments.

**Use:** ~5 minute schedule. Reads tickets, agents, queues, metrics. **Recommendations only** — no reassign.

**Scenario:** Leave agents running ~5 minutes with real tickets and staff. Working if a manager rec about balancing appears. Tickets must not be reassigned by themselves.

---

## 14. Insights & Analytics Agent

**Why it exists:** Org insights should come from real metrics. Empty data must stay empty.

**Use:** ~10 minute schedule (or on-demand insights). Prefers **`ask_semantic_layer`** (company `organization_id`) for catalog metrics; falls back to Express `get_analytics` / `get_metrics` / `get_csat_reports` if the gateway is down. Recommendation only. Never invents KPIs.

**Scenario:** Wait ~10 minutes with agents running. Working if the rec matches real numbers, or honestly says no analytics.

---

## 15. Root Cause & Learning Agent

**Why it exists:** Recurring failure patterns should update **routing weights** the routing agent (ITRA) can read — continuous learning without writing tickets or cluttering Approvals.

**Use:** ~1 hour schedule. Prefers **`ask_semantic_layer`** for outcome patterns; also reads tickets/audit (and Express analytics/CSAT if semantic is empty). Identifies recurring issues; writes an org learning blob (`skill_weights` + `recurring_issues`). **Silent** — ASGA executes for audit only; **does not** appear on Approvals Recommendations. No ticket create/update tools.

**Scenario:** Wait ~1 hour with agents running after enough ticket history. Working if routing weights change (ITRA sees them on the next new ticket) and no Approvals card / no ticket is created or edited.

---

## Short codes (internal only)

| Code | Full name |
|------|-----------|
| TCAA | Ticket Creation & Capture Agent |
| DSSA | Deflection & Self-Service Agent |
| ICPA | Classification & Prioritization Agent |
| ITRA | Intelligent Routing Agent |
| RKAA | Resolution Knowledge Agent |
| STDA | Similar Ticket Detection Agent |
| ARA | Autonomous Resolution Agent |
| TSAA | Ticket Summary Assistant |
| CRDA | Customer Response Drafting Agent |
| RQA | Resolution Quality Agent |
| SEMA | SLA & Escalation Agent |
| PNA | Personalized Notifications Agent |
| WLOA | Workload Optimization Agent |
| TIAA | Insights & Analytics Agent |
| RCAA | Root Cause & Learning Agent |

ASGA is **not** an agent. It is the deterministic safety gate after every proposal.

---

## Related

- **Simple guide (proactive / semi-active / autonomous):** [`agents-working-guide.md`](./agents-working-guide.md)
- **End-to-end create → resolve (autonomous vs semi-autonomous):** [`agents-ticket-lifecycle.md`](./agents-ticket-lifecycle.md)
- Chat architecture: [`agents.md`](./agents.md)
- Ownership freeze: [`architecture-freeze.md`](./architecture-freeze.md)
- Code: `ai-agents/app/proactive/`
- Tests (isolated from chat): `ai-agents/tests/test_proactive_agents.py`
- UI: `ui-frontend/src/components/ApprovalsView.tsx`
