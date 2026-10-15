# Worktual Ticketing System — All Agents (Clear Guide)

This is your **Multi-Agent System (MAS)** as it works today: who does what, when they run, and what information they need.

Companion docs:

- [agents-ticket-lifecycle.md](./agents-ticket-lifecycle.md) — lifecycle and autonomous vs semi-autonomous modes
- [proactive-agents.md](./proactive-agents.md) — per-agent Approvals behaviour
- [agents.md](./agents.md) — chat co-worker architecture (LangGraph)

---

## How the system is organized

There are **three layers of “agents”**, plus one **safety gate**:

| Layer | Name | Who starts it | Simple role |
|-------|------|---------------|-------------|
| **0** | Super Agent | Every chat message | “Which specialist should handle this?” |
| **A** | Chat specialists | Staff or customer in chat | “Help a person do a task step by step” |
| **B** | Proactive agents | System (events / timers) | “Watch tickets and act or suggest without chat” |
| **—** | ASGA | After every proactive action | “Is this safe to run automatically?” |

**Important:** Chat and proactive agents **do not replace each other**. Chat is for people asking for help. Proactive agents run in the background when something happens (new ticket, customer reply, SLA risk, etc.).

All writes go through **Express → Postgres**. Agents never write to the database directly.

---

# LEVEL 0 — Super Agent (Router)

### What it is

The **brain of chat routing**. It reads what the user said and decides what to do next.

### What it does

- Continues an active task (e.g. still creating a ticket)
- Starts a new task (e.g. “create a team”)
- Handles side questions (e.g. “show my open tickets” while filing a ticket)
- Cancels or resumes parked work
- Sends the user to the right **specialist** (Tickets, Teams, Customers, KB, Macros, Admin)

### What it does **not** do

- Does not collect ticket fields itself
- Does not treat “yes” / “proceed” as permission to save — the **specialist** handles that
- Does not bypass Express or RBAC

### What it needs

- The user’s latest message
- Session memory (active workflow, draft fields already filled, open ticket on screen)

---

# LEVEL A — Chat Co-worker Specialists

These run when someone **types in chat** (staff console or customer portal). They **ask for missing information**, then call tools to create or update data.

---

## A1. Tickets Specialist

### Purpose

Help staff **create tickets**, **reassign** them, **escalate** them, and answer ticket-related questions.

### Function: Create ticket

**What happens:**

1. User says they want to file a ticket.
2. Specialist collects **customer + issue** only.
3. System runs **enrich** (triage + ITRA): builds subject, priority, team, L1 agent, L2 resolver.
4. User confirms in chat (e.g. “yes”).
5. Ticket is saved in the database.

**Fields collected from the user:**

| Field | Required | Explanation |
|-------|----------|-------------|
| **Customer name** | Yes | Full name of the person reporting the issue |
| **Contact** | Yes | **Either** email **or** phone (one is enough) |
| **Issue** | Yes | Short description of the problem |

**Filled automatically (user is not asked):**

| Field | Who fills it |
|-------|----------------|
| Subject & description | Triage / enrich from the issue |
| Priority | Classification at enrich |
| Team / queue | Triage from team descriptions |
| L1 agent (assignee) | ITRA routing |
| L2 resolver | ITRA routing |

### Function: Reassign ticket

**What happens:**

1. User wants to change who owns the ticket.
2. System finds the ticket (from screen context or ticket number).
3. User picks **agent (L1)** or **resolver (L2)** — they are **never swapped**.
4. User picks a person from the **live roster**.
5. System updates the correct column.

**Fields needed:**

| Field | Required | Explanation |
|-------|----------|-------------|
| **Ticket number** | Yes | e.g. `#12802`, or “this ticket” if already open |
| **Target role** | Yes | `agent` = L1 assignee, `resolver` = L2 resolver |
| **Person** | Yes | Exact name from org roster |
| Note | No | Optional reason |

### Function: Escalate ticket

**What happens:** Hand ticket to a resolver (L2) with optional note.

**Fields needed:**

| Field | Required | Explanation |
|-------|----------|-------------|
| **Ticket number** | Yes | Which ticket |
| **Assignee / resolver** | Yes | Who receives it |
| Note | No | Optional context |

---

## A2. Teams Specialist

### Purpose

Create teams and add people to existing teams.

### Create team

| Field | Required | Explanation |
|-------|----------|-------------|
| **Team name** | Yes | Name shown in Teams module |
| **Description** | Yes | What kind of tickets this team handles (used for routing) |
| **Members** | Yes | At least one staff name from the org |

### Add members to existing team

| Field | Required | Explanation |
|-------|----------|-------------|
| **Team** | Yes | Which existing team |
| **Members** | Yes | Staff to add (only people **not already** on the team) |

---

## A3. Customers Specialist

### Purpose

Add customers to the directory (CDP). Also used when **create ticket** fails because the customer is missing.

### Add customer

| Field | Required | Explanation |
|-------|----------|-------------|
| **Name** | Yes | Full name |
| **Email** | Yes | Email address |
| **Phone** | Yes | Phone number |
| Account name | No | Company / account label |

After create, a parked ticket can **resume** with the new customer linked.

---

## A4. Knowledge Base (KB) Specialist

### Purpose

Create and manage help articles and categories.

### Create article

| Field | Required | Explanation |
|-------|----------|-------------|
| **Title** | Yes | Article headline |
| **Category** | Yes | Pick from live categories or create a new one |
| **Body** | Yes | Full article content |

### Manage category

| Field | Required | Explanation |
|-------|----------|-------------|
| **Mode** | Yes | add / edit / delete |
| **Name** | Yes | Category name |

### Update article

Uses article identity + new title/body/category (via chat + tools).

---

## A5. Macros Specialist

### Purpose

Create canned replies (“notes”) staff paste into ticket replies.

### Create macro

| Field | Required | Explanation |
|-------|----------|-------------|
| **Title** | Yes | Macro name |
| **Body** | Yes | Reply text |

Update/delete: macro title or id + new content or confirm delete.

---

## A6. Admin Specialist

### Purpose

Org setup: priorities, statuses, analytics, audit reads.

### Create priority

| Field | Required | Explanation |
|-------|----------|-------------|
| **Display name** | Yes | e.g. High, Urgent |
| **Resolution hours** | Yes | SLA time for that priority |

### Create status

| Field | Required | Explanation |
|-------|----------|-------------|
| **Display name** | Yes | e.g. Pending, Open |

Also supports rename, activate/deactivate, delete for priorities and statuses.

---

## A7. General & Portal

| Specialist | Purpose |
|------------|---------|
| **General** | Navigation, cross-module help when no specific module is active |
| **Portal (customer)** | Customer-facing chat: help, KB, create/view own tickets |

Portal customer identity comes from **login session**, not typed each time.

---

# LEVEL B — Proactive Agents (Background Automation)

These run **without anyone typing in chat**. They react to **events** (new ticket, customer reply) or **schedules** (every few minutes).

After each action, **ASGA** decides:

- **Run now** (autonomous)
- **Show on Approvals for Confirm** (semi-autonomous)
- **Show as recommendation only** (human decides)
- **Reject** (do nothing)

All **14** proactive agents in the current codebase are listed below.

---

## LAYER 1 — Intake & Routing

*“Get the ticket in, understood, and on the right desk”*

### 1. DSSA — Deflection & Self-Service Agent

**Purpose:** Try to solve the problem **before** opening a ticket.

**When it runs:** Inbound message (email, intake API, etc.) **before** ticket creation.

**What it does:**

- Reads the customer message
- Searches published Knowledge Base
- If KB can help → sends guided steps (interactive troubleshooting)
- If self-service works → **no ticket** is created

**What it needs:** Organization id + message text (+ channel metadata).

**What it does not do:** Create tickets or change existing tickets.

---

### 2. TCAA — Ticket Creation & Capture Agent

**Purpose:** Turn an inbound message into a **structured ticket** when deflection did not work.

**When it runs:** After DSSA decides **not** to deflect.

**What it does:**

- Extracts customer name, email, subject, description, channel from free text
- Proposes or runs `create_ticket`

**What it needs:**

| Input | Explanation |
|-------|-------------|
| Inbound text | Email body, chat message, etc. |
| Organization | Which org owns the ticket |

**Extracted fields:**

| Field | Meaning |
|-------|---------|
| Customer name | Who reported |
| Customer email | Contact (when present) |
| Subject | Short title |
| Description | Full issue text |
| Channel | Email / Chat / Web / Phone |

---

### 3. ICPA — Issue Classification & Prioritization Agent

**Purpose:** Set **how important** the ticket is and **what type** it is.

**When it runs:** Right after a ticket is **created** (`ticket.created`).

**What it does:**

- Reads subject + description
- Sets **priority** (low / medium / high / urgent)
- Sets **category** and **queue/team** when confident
- Updates the ticket via Express

**What it needs:** Ticket number + issue text + list of teams/queues.

**Does not ask the user** — works from ticket content only.

---

### 4. ITRA — Intelligent Ticket Routing Agent

**Purpose:** Put the ticket on the **right people**: L1 **agent** and L2 **resolver**.

**When it runs:** After ticket create (and after ICPA completes).

**What it does:**

- Loads live staff roster (agents vs resolvers)
- Matches **skills** to the issue
- Considers **open workload** (who is less busy)
- Uses **RCAA learning weights** when available
- Assigns L1 to **assignee** column; L2 to **resolver** column (never cross-assigns)

**What it needs:**

| Input | Explanation |
|-------|-------------|
| Ticket number | Which ticket |
| Issue / subject / description | What the ticket is about |
| Skill / category / queue | From ICPA or triage |
| Org roster | Real people from database |

**Note:** At **chat create**, L1+L2 are also set during **enrich** using the same ITRA engine. Proactive ITRA mainly adjusts **L1** after create.

---

## LAYER 2 — Resolution Assistance

*“Help agents resolve faster and communicate better”*

### 5. RKAA — Resolution Knowledge Assistant Agent

**Purpose:** Tell assignee/resolver **what might fix** the ticket.

**When it runs:** New ticket created; can also run on demand.

**What it does:**

- Finds relevant **KB articles**
- Finds **similar past tickets**
- Writes a short **next best action** recommendation

**Mode:** Recommendation only — **does not** change the ticket.

---

### 6. ARA — Autonomous Resolution Agent

**Purpose:** Handle **close / reopen** when the **customer** says the issue is fixed or still broken.

**When it runs:** Customer reply (portal, email thread, etc.) or portal bot turn.

**What it does:**

- Reads customer message in context
- If customer confirms fixed → propose **Resolved**
- If customer says still broken → propose **Reopened**

**Mode:** Always needs **Confirm on Approvals** (high risk).

**What it needs:** Ticket number + customer message + current status (+ portal history if needed).

**What it is not:** Not a playbook for password reset or order status — only lifecycle status changes.

---

### 7. SEMA — SLA & Escalation Management Agent

**Purpose:** Protect **SLA deadlines** — warn and escalate before things breach.

**When it runs:** Ticket updates, SLA-at-risk events, and on a ~1 minute schedule.

**What it does:**

- Checks time left until due
- Recommends **alert**, **reassign**, or **escalate**
- Can propose escalate/reassign tools (Confirm required for writes)

**What it needs:** Ticket due date, status, assignee, list of open tickets.

**Express also sends** SLA reminder/breach emails — SEMA is the **AI reasoning** layer on top.

---

### 8. TSAA — Ticket Summary Assistant Agent

**Purpose:** Keep a **living summary** on the ticket so anyone can pick it up quickly.

**When it runs:** Create, comments, updates, customer replies, schedule.

**What it does:**

- Reads ticket + notes + activity
- Writes **`ai_summary`** on the ticket

**Mode:** Runs **automatically** (summary-only write — no Approvals).

**Benefit:** Less manual documentation; smoother handovers.

---

### 9. CRDA — Customer Response Drafting Agent

**Purpose:** Draft a **reply to the customer** so agents don’t start from a blank page.

**When it runs:** After **customer replied** (or on-demand draft).

**What it does:**

- Reads ticket + customer’s latest message
- Generates a professional reply draft
- Puts it forward for **Send / Confirm** — does **not** auto-send to customer without approval

**What it needs:** Ticket context + customer message + thread history.

**Gap today:** Does not yet draft the **first outbound** message on brand-new tickets (only after customer writes).

---

## LAYER 3 — Intelligence & Operations

*“Learn, balance, notify, and improve the org”*

### 10. STDA — Similar Ticket Detection Agent

**Purpose:** Spot **duplicates** and **repeat incidents** early.

**When it runs:** New ticket created.

**What it does:**

- Compares new ticket to similar open/recent tickets
- Pulls solutions from notes, macros, KB
- Recommends “this might be the same issue — try X”

**Mode:** Recommendation only. **Does not merge** tickets (by design).

---

### 11. RCAA — Root Cause & Continuous Learning Agent

**Purpose:** Learn from history and **make routing smarter over time**.

**When it runs:** About hourly (schedule).

**What it does:**

- Analyzes tickets, CSAT, analytics, audit
- Finds **recurring themes**
- Updates **soft routing weights** that **ITRA** uses next time

**Mode:** Silent automatic update — no Approvals card.

**Does not** change individual tickets.

---

### 12. WLOA — Workload & Optimization Agent

**Purpose:** Spot **unbalanced workload** across agents.

**When it runs:** About every 5 minutes.

**What it does:**

- Counts open tickets per assignee
- If someone is overloaded → writes a **recommendation** for managers

**Mode:** Recommendation only — **does not** reassign tickets itself.

---

### 13. TIAA — Ticket Insights & Analytics Agent

**Purpose:** Org-level **insights** for managers (volume, SLA risk, CSAT trends).

**When it runs:** ~10 minute schedule or on-demand insights.

**What it does:**

- Queries semantic layer / analytics / metrics
- Produces a readable insight summary

**Mode:** Recommendation only — **not** a dashboard UI; shows in Approvals/recommendations.

---

### 14. PNA — Personalized Notification Agent

**Purpose:** Keep **staff** informed in the **header bell**.

**When it runs:** Ticket created, updated, commented, customer replied, SLA at risk, etc.

**What it does:**

- Picks recipients (assignee, resolver, notify list)
- LLM writes short title + message
- Sends to staff **in-app notification** (not customer email)

**Respects:** opt-out / preference flags when set.

**What it is not:** Not the main customer-facing email system (that is Express mail templates).

---

# COMMON — ASGA (Safety Gate)

### What it is

**Not an agent** — mandatory middleware after every proactive proposal.

### What it does

| Check | Result |
|-------|--------|
| Tool allowed for this agent? | Reject if not |
| Confidence high enough? | Recommend if too low |
| High risk? (close, escalate, public note, steal assignee) | **Approvals Confirm** |
| Safe low-risk write? | Execute immediately |
| Recommendation-only output? | Show in Approvals recommendations |

### Why it exists

Safe, compliant, enterprise-ready AI: **automation where safe**, **human Confirm where risky**.

---

# End-to-end example (plain language)

```text
1. Customer emails: "I can't log in to VPN"
2. DSSA     → Checks KB; tries self-service steps first
3. TCAA     → If still needed, creates ticket from the email text
4. ICPA     → Sets priority = High, category = Network
5. ITRA     → Assigns L1 agent + L2 resolver by skill and workload
6. RKAA     → "See KB article VPN Troubleshooting"
7. STDA     → "Similar to ticket #12701 last week"
8. TSAA     → Writes ai_summary for the assignee
9. PNA      → Notifies assignee in the bell
10. Agent works ticket in console (chat specialist if they ask)
11. Customer replies "still broken"
12. CRDA    → Drafts reply for agent to Send
13. ARA     → May propose Reopen if needed (Confirm)
14. SEMA    → Warns if SLA is near breach
15. Customer says "fixed, thanks"
16. ARA     → Proposes Resolved (Confirm)
17. RCAA    → Learns patterns hourly for better routing tomorrow
```

---

# Proactive agents checklist (current codebase)

| # | Agent | Layer |
|---|--------|-------|
| 1 | DSSA — Deflection & Self-Service | 1 |
| 2 | TCAA — Ticket Creation & Capture | 1 |
| 3 | ICPA — Classification & Prioritization | 1 |
| 4 | ITRA — Intelligent Routing | 1 |
| 5 | RKAA — Resolution Knowledge | 2 |
| 6 | ARA — Autonomous Resolution | 2 |
| 7 | SEMA — SLA & Escalation | 2 |
| 8 | TSAA — Ticket Summary | 2 |
| 9 | CRDA — Customer Response Drafting | 2 |
| 10 | STDA — Similar Ticket Detection | 3 |
| 11 | RCAA — Root Cause & Learning | 3 |
| 12 | WLOA — Workload & Optimization | 3 |
| 13 | TIAA — Insights & Analytics | 3 |
| 14 | PNA — Personalized Notification | 3 |
| — | ASGA — Safety & Guardrails | Common |

Source: `ai-agents/app/proactive/registry_agents.py`

---

# Planned agents (not live yet)

| Agent | Purpose |
|-------|---------|
| **MIA** (Information Gap-Filler) | Ask customer for missing account ID, error, steps after create |
| **CFU** (Customer Follow-up) | Nudge when customer goes quiet; suggest close if resolved |
| **CRA** (CSAT Recovery) | Follow up on low or missing satisfaction scores |

---

# Quick reference — chat fields only

| Task | What you collect in chat |
|------|---------------------------|
| Create ticket | Name, email **or** phone, issue |
| Add customer | Name, email, phone |
| Create team | Name, description, members |
| Add team members | Team name, member names |
| Create KB article | Title, category, body |
| Create macro | Title, body |
| Create priority | Name, SLA hours |
| Create status | Name |
| Reassign | Ticket #, agent **or** resolver, person name |
| Escalate | Ticket #, resolver name |
