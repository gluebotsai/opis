# Worktual Ticketing System — All Agents (Clear Guide)

This is your **Multi-Agent System (MAS)** as it works today: who does what, when they run, what information they need, and which **tools + parameters** they use.

Companion docs:

- [agents-ticket-lifecycle.md](./agents-ticket-lifecycle.md) — lifecycle and autonomous vs semi-autonomous modes
- [proactive-agents.md](./proactive-agents.md) — per-agent Approvals behaviour
- [agents.md](./agents.md) — chat co-worker architecture (LangGraph)

Tool allowlists live in `ai-agents/app/tools/registry.py`. Tool implementations live in `ai-agents/app/tools/`.

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
- Does not call Express mutate tools
- Does not bypass Express or RBAC

### Tools

None (routing / NLU only). Uses session memory and specialist handoff.

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

**Tools used:**

| Step | Tool | Parameters |
|------|------|------------|
| Verify customer in directory | `verify_ticket_customer` | `customerName`, `contact` **or** `customerEmail` / `customerPhone` |
| Enrich (priority, queue, L1, L2) | `enrich_ticket` | `customerName` (required), `issue` (required), optional `contact` / `customerEmail` / `customerPhone` |
| Save ticket | `create_ticket` | `customerName` (required unless subject), optional `customerEmail`, `customerPhone`, `subject`, `description`, `priority`, `queue`, `assignee`, `assigneeId`, `resolver`, `resolverId`, `channel`, `category` |
| Draft while collecting | `patch_ticket_draft` | draft slot fields (`customerName`, `contact`, `issue`, …) |

---

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

**Tools used:**

| Step | Tool | Parameters |
|------|------|------------|
| Load live roster | `resolve_ticket_person` | optional `ticket_number`, `target_role` (`agent` \| `resolver`), `user_query`, `response`, `proceed` |
| Reassign **agent (L1)** | `update_ticket` | `ticket_number` (required), `assignee` (person name) |
| Reassign **resolver (L2)** | `escalate_ticket` | `ticket_number` (required), `assignee` / `assignee_id` (resolver), optional `agent` / `agent_id`, `rationale` |
| Draft while collecting | `patch_reassign_draft` | `ticket_number`, `target_role`, `person`, … |

---

### Function: Escalate ticket

**What happens:** Hand ticket to a resolver (L2) with optional note.

**Fields needed:**

| Field | Required | Explanation |
|-------|----------|-------------|
| **Ticket number** | Yes | Which ticket |
| **Assignee / resolver** | Yes | Who receives it |
| Note | No | Optional context |

**Tools used:**

| Tool | Parameters |
|------|------------|
| `escalate_ticket` | `ticket_number` (required), `assignee` / `assignee_id`, optional `agent` / `agent_id`, `rationale` |
| `resolve_ticket_person` | optional `ticket_number`, `target_role=resolver` |
| `patch_escalate_draft` | draft slots while collecting |

### Other common ticket tools

| Tool | Parameters | Purpose |
|------|------------|---------|
| `list_tickets` | optional `scope`, filters, `sort`, `limit` | List / search tickets |
| `get_ticket` | `ticket_number` | Load one ticket |
| `get_ticket_progress` | `ticket_number` | Ticket history / progress |
| `add_ticket_note` | `ticket_number`, `text`, optional `visibility` (`internal` \| `public`) | Add note |
| `auto_assign_ticket` | `ticket_number` | Backend auto-route |

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

**Tools used:**

| Tool | Parameters |
|------|------------|
| `list_agents` | (none) — load staff roster |
| `list_queues` | optional `query` — list existing teams |
| `create_queue` | `name` (required), `description`, `members` (list of names) **or** `member_ids` |
| `patch_team_draft` | draft slots while collecting |

### Add members to existing team

| Field | Required | Explanation |
|-------|----------|-------------|
| **Team** | Yes | Which existing team |
| **Members** | Yes | Staff to add (only people **not already** on the team) |

**Tools used:**

| Tool | Parameters |
|------|------------|
| `list_queues` | optional `query` — find team |
| `list_agents` | (none) — available staff |
| `update_queue` | `queue_id` (required), `members` (list), `add_members=true` (append), optional `name`, `description`, `member_ids` |
| `delete_queue` | `queue_id` — delete team |

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

**Tools used:**

| Tool | Parameters |
|------|------------|
| `create_customer` | `name` (required), `email`, `phone` (email or phone required at API), optional `account_name` |
| `list_customers` | optional `query`, `exact_email`, `exact_phone`, `status` |
| `get_customer_360` | `email` |
| `import_customers` | `csv_text` |
| `patch_customer_draft` | draft slots while collecting |

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

**Tools used:**

| Tool | Parameters |
|------|------------|
| `list_kb_categories` | (none) — live category labels |
| `manage_kb_category` | `name`, `mode` (`add` \| `list`, …) |
| `create_kb_article` | `title` (required), `content` (or `body`), `category` (required), optional `author`, `status` |
| `patch_kb_draft` | draft slots while collecting |

### Manage category

| Field | Required | Explanation |
|-------|----------|-------------|
| **Mode** | Yes | add / edit / delete |
| **Name** | Yes | Category name |

**Tool:** `manage_kb_category` — `mode`, `name`

### Update / publish article

| Tool | Parameters |
|------|------------|
| `get_kb` | `article_id` |
| `list_kb` | optional `query`, `category`, `status` |
| `update_kb_article` | `article_id` (required), optional `title`, `content`, `category`, `status` |
| `publish_kb_article` | `article_id` |
| `export_kb` | optional `fmt` (`json` \| `csv`), `category` |
| `import_kb_articles` | JSON array of `{title, content, category}` |

---

## A5. Macros Specialist

### Purpose

Create canned replies (“notes”) staff paste into ticket replies.

### Create macro

| Field | Required | Explanation |
|-------|----------|-------------|
| **Title** | Yes | Macro name |
| **Body** | Yes | Reply text |

**Tools used:**

| Tool | Parameters |
|------|------------|
| `create_macro` | `title` (required), `body` (required) |
| `list_macros` | optional `query` |
| `update_macro` | `macro_id` (required), optional `title`, `body` |
| `delete_macro` | `macro_id` |
| `patch_macro_draft` | draft slots while collecting |

---

## A6. Admin Specialist

### Purpose

Org setup: priorities, statuses, analytics, audit reads.

### Create priority

| Field | Required | Explanation |
|-------|----------|-------------|
| **Display name** | Yes | e.g. High, Urgent |
| **Resolution hours** | Yes | SLA time for that priority |

**Tools used:**

| Tool | Parameters |
|------|------------|
| `create_priority` | `display_name` (required), `resolution_hours` (required, > 0) |
| `list_priorities` | optional `include_inactive` |
| `update_priority` | `priority_id` (required), optional `display_name`, `resolution_hours`, `active` |
| `delete_priority` | `priority_id` |
| `patch_priority_draft` | draft slots |

### Create status

| Field | Required | Explanation |
|-------|----------|-------------|
| **Display name** | Yes | e.g. Pending, Open |

**Tools used:**

| Tool | Parameters |
|------|------------|
| `create_status` | `display_name` (required) |
| `list_statuses` | optional `include_inactive` |
| `update_status` | `status_id` (required), optional `display_name`, `active` |
| `delete_status` | `status_id` |
| `patch_status_draft` | draft slots |

### Other admin tools (reads / org)

| Tool | Parameters | Purpose |
|------|------------|---------|
| `get_metrics` | (none / range as implemented) | Dashboard metrics |
| `get_analytics` | — | Analytics |
| `get_csat_reports` | range e.g. `7days` / `30days` / `90days` | CSAT reports |
| `list_audit` | optional `action`, `actor`, `ticket`, range | Audit log |
| `get_org_preferences` / `update_org_preferences` | prefs fields | Org settings |
| `list_automation_rules` / `create_automation_rule` / `update_automation_rule` / `delete_automation_rule` | rule id / conditions / actions | Express automation rules |

---

## A7. General & Portal

| Specialist | Purpose | Key tools |
|------------|---------|-----------|
| **General** | Navigation, cross-module help | `navigate`, plus broad read/create allowlist |
| **Portal (customer)** | Customer-facing chat: help, KB, create/view own tickets | `portal_list_tickets`, `portal_create_ticket` (`issue`), `list_kb`, `get_kb` |

Portal customer identity comes from **login session**, not typed each time.

---

# LEVEL B — Proactive Agents (Background Automation)

These run **without anyone typing in chat**. They react to **events** (new ticket, customer reply) or **schedules** (every few minutes).

After each action, **ASGA** decides:

- **Run now** (autonomous)
- **Show on Approvals for Confirm** (semi-autonomous)
- **Show as recommendation only** (human decides)
- **Reject** (do nothing)

All **15** proactive agents in the current codebase are listed below.

Allowlists: `ai-agents/app/tools/registry.py` (`tcaa`, `icpa`, `itra`, …).

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

**Allowed tools:**

| Tool | Parameters | How used |
|------|------------|----------|
| `list_kb` | optional `query`, `category`, `status` | Find published articles |
| `get_kb` | `article_id` | Load full article body for steps |
| `list_tickets` | optional filters | Context only (rare) |

**Writes:** None (recommendation / skip create only).

---

### 2. TCAA — Ticket Creation & Capture Agent

**Purpose:** Turn an inbound message into a **structured ticket** when deflection did not work.

**When it runs:** After DSSA decides **not** to deflect.

**What it does:**

- Extracts customer name, email, subject, description, channel from free text
- Proposes or runs `create_ticket`

**Allowed tools:**

| Tool | Parameters | How used |
|------|------------|----------|
| `create_ticket` | `customerName`, `customerEmail`, `subject`, `description`, `channel`, … | Create ticket |
| `list_customers` | optional `query`, `exact_email`, `exact_phone` | Match existing customer |
| `list_kb` | optional `query` | Optional context |

**Typical create payload:**

| Parameter | Meaning |
|-----------|---------|
| `customerName` | Who reported |
| `customerEmail` | Contact (when present) |
| `subject` | Short title |
| `description` | Full issue text |
| `channel` | Email / Chat / Web / Phone |

---

### 3. ICPA — Issue Classification & Prioritization Agent

**Purpose:** Set **how important** the ticket is and **what type** it is.

**When it runs:** Right after a ticket is **created** (`ticket.created`).

**What it does:**

- Reads subject + description
- Sets **priority** (low / medium / high / urgent)
- Sets **category** and **queue/team** when confident
- Updates the ticket via Express

**Allowed tools:**

| Tool | Parameters | How used |
|------|------------|----------|
| `get_ticket` | `ticket_number` | Load ticket |
| `list_queues` | optional `query` | Valid team names |
| `list_tickets` | optional filters | Context |
| `update_ticket` | `ticket_number` (required), `priority`, `category`, `queue` | Apply classification |

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

**Allowed tools:**

| Tool | Parameters | How used |
|------|------------|----------|
| `get_ticket` | `ticket_number` | Load ticket |
| `list_agents` | (none) | Live roster |
| `list_queues` | optional `query` | Team pool |
| `list_tickets` | optional filters | Workload context |
| `update_ticket` | `ticket_number`, `assignee` (and optionally related fields) | Assign L1 |
| `auto_assign_ticket` | `ticket_number` | Backend auto-route path |

**Core routing engine:** `route_assignment()` in `ai-agents/app/proactive/itra.py` (also used by chat `enrich_ticket`).

**Note:** At **chat create**, L1+L2 are set during **enrich**. Proactive ITRA mainly adjusts **L1** after create.

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

**Allowed tools:**

| Tool | Parameters |
|------|------------|
| `get_ticket` | `ticket_number` |
| `list_kb` | optional `query`, `category`, `status` |
| `list_tickets` | optional filters |
| `list_ticket_recommendations` | optional `ticket_number` |

---

### 6. ARA — Autonomous Resolution Agent

**Purpose:** Handle **close / reopen** when the **customer** says the issue is fixed or still broken.

**When it runs:** Customer reply (portal, email thread, etc.) or portal bot turn.

**What it does:**

- Reads customer message in context
- If customer confirms fixed → propose **Resolved**
- If customer says still broken → propose **Reopened**

**Mode:** Always needs **Confirm on Approvals** (high risk).

**Allowed tools:**

| Tool | Parameters | How used |
|------|------------|----------|
| `get_ticket` | `ticket_number` | Load current status |
| `update_ticket` | `ticket_number`, `status` (`Resolved` / `Reopened`) | Lifecycle change |

**What it is not:** Not a playbook for password reset or order status — only lifecycle status changes.

---

### 7. SEMA — SLA & Escalation Management Agent

**Purpose:** Protect **SLA deadlines** — warn and escalate before things breach.

**When it runs:** Ticket updates, SLA-at-risk events, and on a ~1 minute schedule.

**What it does:**

- Checks time left until due
- Recommends **alert**, **reassign**, or **escalate**
- Can propose escalate/reassign tools (Confirm required for writes)

**Allowed tools:**

| Tool | Parameters | How used |
|------|------------|----------|
| `get_ticket` | `ticket_number` | Load due date / status |
| `list_tickets` | optional filters | Sweep open tickets |
| `list_agents` | (none) | Reassign candidates |
| `update_ticket` | `ticket_number`, `assignee`, … | Propose reassign |
| `escalate_ticket` | `ticket_number`, `assignee` / `assignee_id`, optional `rationale` | Propose escalate |
| `send_staff_notification` | `user_id`, `title`, `message`, optional `kind`, `ticket_uuid`, `customer_name` | Alert staff |

**Express also sends** SLA reminder/breach emails — SEMA is the **AI reasoning** layer on top.

---

### 8. TSAA — Ticket Summary Assistant Agent

**Purpose:** Keep a **living summary** on the ticket so anyone can pick it up quickly.

**When it runs:** Create, comments, updates, customer replies, schedule.

**What it does:**

- Reads ticket + notes + activity
- Writes **`ai_summary`** on the ticket

**Mode:** Runs **automatically** (summary-only write — no Approvals).

**Allowed tools:**

| Tool | Parameters | How used |
|------|------------|----------|
| `get_ticket` | `ticket_number` | Load ticket |
| `get_ticket_progress` | `ticket_number` | Activity history |
| `list_ticket_notes` | `ticket_number` | Recent notes |
| `list_tickets` | optional filters | Schedule pick |
| `update_ticket` | `ticket_number`, `ai_summary` | Write summary only |

---

### 9. CRDA — Customer Response Drafting Agent

**Purpose:** Draft a **reply to the customer** so agents don’t start from a blank page.

**When it runs:** After **customer replied** (or on-demand draft).

**What it does:**

- Reads ticket + customer’s latest message
- Generates a professional reply draft
- Puts it forward for **Send / Confirm** — does **not** auto-send without approval

**Mode:** Always Confirm / Send (high risk — public note).

**Allowed tools:**

| Tool | Parameters | How used |
|------|------------|----------|
| `get_ticket` | `ticket_number` | Ticket context |
| `get_ticket_progress` | `ticket_number` | Thread / progress |
| `add_ticket_note` | `ticket_number`, `text` (draft), `visibility=public` | Propose customer-visible reply |

**Gap today:** Does not yet draft the **first outbound** message on brand-new tickets (only after customer writes).

---

### 9b. RQA — Resolution Quality Agent

**Purpose:** Catch **Resolved** tickets that have no real close-out documentation.

**When it runs:** Only when status is **updated to Resolved**. Not a timer. Not other ticket updates.

**What it does:**

- Reads ticket + notes + progress
- Ignores `ai_summary` as proof the fix was documented
- If notes already explain the fix → silence
- If not → recommendation, or an **internal** closing-note draft for Confirm
- Never reopens. Never auto-writes. Never sends a public customer reply.

**Mode:** Recommend or Confirm (high risk). Disable with `PROACTIVE_RQA=0`.

**Allowed tools:**

| Tool | Parameters | How used |
|------|------------|----------|
| `get_ticket` | `ticket_number` | Ticket fields |
| `list_ticket_notes` | `ticket_number` | Staff / customer notes |
| `get_ticket_progress` | `ticket_number` | Thread / progress |
| `add_ticket_note` | `ticket_number`, `text`, `visibility=internal` | Draft closing note (Confirm) |

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

**Allowed tools:**

| Tool | Parameters |
|------|------------|
| `get_ticket` | `ticket_number` |
| `list_tickets` | optional filters |
| `list_ticket_notes` | `ticket_number` |
| `list_kb` | optional `query` |
| `list_macros` | optional `query` |

---

### 11. RCAA — Root Cause & Continuous Learning Agent

**Purpose:** Learn from history and **make routing smarter over time**.

**When it runs:** About hourly (schedule).

**What it does:**

- Analyzes tickets, CSAT, analytics, audit
- Finds **recurring themes**
- Updates **soft routing weights** that **ITRA** uses next time

**Mode:** Silent automatic update — no Approvals card.

**Allowed tools:**

| Tool | Parameters |
|------|------------|
| `ask_semantic_layer` | `query`, `organization_id` |
| `ask_ontology` | `query`, `organization_id` (optional) |
| `get_analytics` | — |
| `list_tickets` | optional filters |
| `get_csat_reports` | range |
| `list_audit` | optional filters |

**Writes:** Routing weight store (not ticket rows).

---

### 12. WLOA — Workload & Optimization Agent

**Purpose:** Spot **unbalanced workload** across agents.

**When it runs:** About every 5 minutes.

**What it does:**

- Counts open tickets per assignee
- If someone is overloaded → writes a **recommendation** for managers

**Mode:** Recommendation only — **does not** reassign tickets itself.

**Allowed tools:**

| Tool | Parameters |
|------|------------|
| `list_tickets` | optional filters |
| `list_agents` | (none) |
| `list_queues` | optional `query` |
| `get_metrics` | — |

---

### 13. TIAA — Ticket Insights & Analytics Agent

**Purpose:** Org-level **insights** for managers (volume, SLA risk, CSAT trends).

**When it runs:** ~10 minute schedule or on-demand insights.

**What it does:**

- Queries semantic layer / analytics / metrics
- Produces a readable insight summary

**Mode:** Recommendation only — **not** a dashboard UI; shows in Approvals/recommendations.

**Allowed tools:**

| Tool | Parameters |
|------|------------|
| `ask_semantic_layer` | `query`, `organization_id` |
| `ask_ontology` | `query`, `organization_id` |
| `get_analytics` | — |
| `get_metrics` | — |
| `list_tickets` | optional filters |
| `get_csat_reports` | range |

---

### 14. PNA — Personalized Notification Agent

**Purpose:** Keep **staff** informed in the **header bell**.

**When it runs:** Ticket created, updated, commented, customer replied, SLA at risk, etc.

**What it does:**

- Picks recipients (assignee, resolver, notify list)
- LLM writes short title + message
- Sends to staff **in-app notification** (not customer email)

**Mode:** Autonomous inbox write (never Approvals Confirm/Reject).

**Allowed tools:**

| Tool | Parameters | How used |
|------|------------|----------|
| `send_staff_notification` | `user_id` (required), `title` (required), `message` (required), optional `kind`, `ticket_uuid`, `customer_name` | Write bell notification |
| `list_notifications` | — | Context / dedupe helpers |
| `get_ticket` | `ticket_number` | Optional ticket context |

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

**Tools:** None of its own — it gates whatever tool the proactive agent proposed.

---

# End-to-end example (plain language)

```text
1. Customer emails: "I can't log in to VPN"
2. DSSA     → list_kb / get_kb → try self-service steps first
3. TCAA     → create_ticket(customerName, subject, description, channel)
4. ICPA     → update_ticket(priority, category, queue)
5. ITRA     → update_ticket(assignee) / route_assignment for L1 (+ L2 at enrich)
6. RKAA     → list_kb + list_tickets → recommendation card
7. STDA     → similar tickets / macros / KB → recommendation card
8. TSAA     → update_ticket(ai_summary)
9. PNA      → send_staff_notification(user_id, title, message)
10. Agent works ticket in console (chat specialist if they ask)
11. Customer replies "still broken"
12. CRDA    → add_ticket_note(..., visibility=public) [Confirm/Send]
13. ARA     → update_ticket(status=Reopened) [Confirm]
14. SEMA    → escalate_ticket / update_ticket / notify if SLA at risk
15. Customer says "fixed, thanks"
16. ARA     → update_ticket(status=Resolved) [Confirm]
16b. RQA    → add_ticket_note(..., visibility=internal) [Confirm] if close has no resolution note
17. RCAA    → analytics + weights for better ITRA routing tomorrow
```

---

# Proactive agents checklist (current codebase)

| # | Agent | Layer | Primary write tool(s) |
|---|--------|-------|------------------------|
| 1 | DSSA — Deflection & Self-Service | 1 | _(none)_ |
| 2 | TCAA — Ticket Creation & Capture | 1 | `create_ticket` |
| 3 | ICPA — Classification & Prioritization | 1 | `update_ticket` |
| 4 | ITRA — Intelligent Routing | 1 | `update_ticket`, `auto_assign_ticket` |
| 5 | RKAA — Resolution Knowledge | 2 | _(none — recommend)_ |
| 6 | ARA — Autonomous Resolution | 2 | `update_ticket` (`status`) |
| 7 | SEMA — SLA & Escalation | 2 | `escalate_ticket`, `update_ticket`, `send_staff_notification` |
| 8 | TSAA — Ticket Summary | 2 | `update_ticket` (`ai_summary`) |
| 9 | CRDA — Customer Response Drafting | 2 | `add_ticket_note` (`visibility=public`) |
| 10 | STDA — Similar Ticket Detection | 3 | _(none — recommend)_ |
| 11 | RCAA — Root Cause & Learning | 3 | routing weight store (not ticket mutate) |
| 12 | WLOA — Workload & Optimization | 3 | _(none — recommend)_ |
| 13 | TIAA — Insights & Analytics | 3 | _(none — recommend)_ |
| 14 | PNA — Personalized Notification | 3 | `send_staff_notification` |
| 15 | RQA — Resolution Quality | 2 | `add_ticket_note` (`visibility=internal`) after Confirm |
| — | ASGA — Safety & Guardrails | Common | _(gate only)_ |

Source: `ai-agents/app/proactive/registry_agents.py`, `ai-agents/app/tools/registry.py`

---

# Planned agents (not live yet)

| Agent | Purpose |
|-------|---------|
| **MIA** (Information Gap-Filler) | Ask customer for missing account ID, error, steps after create |
| **CFU** (Customer Follow-up) | Nudge when customer goes quiet; suggest close if resolved |
| **CRA** (CSAT Recovery) | Follow up on low or missing satisfaction scores |

---

# Quick reference — chat fields + tools

| Task | Collect from user | Primary tool | Key parameters |
|------|-------------------|--------------|----------------|
| Create ticket | Name, email **or** phone, issue | `enrich_ticket` → `create_ticket` | `customerName`, `contact`/`issue`; then create payload |
| Add customer | Name, email, phone | `create_customer` | `name`, `email`, `phone` |
| Create team | Name, description, members | `create_queue` | `name`, `description`, `members` |
| Add team members | Team name, member names | `update_queue` | `queue_id`, `members`, `add_members=true` |
| Create KB article | Title, category, body | `create_kb_article` | `title`, `category`, `content`/`body` |
| Create macro | Title, body | `create_macro` | `title`, `body` |
| Create priority | Name, SLA hours | `create_priority` | `display_name`, `resolution_hours` |
| Create status | Name | `create_status` | `display_name` |
| Reassign agent | Ticket #, person | `update_ticket` | `ticket_number`, `assignee` |
| Reassign resolver / escalate | Ticket #, person | `escalate_ticket` | `ticket_number`, `assignee` |
