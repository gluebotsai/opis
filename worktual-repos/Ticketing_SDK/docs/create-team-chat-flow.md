# Create-team chat flow

How the Worktual co-worker creates a **team (queue)** in chat: name → description → members → `POST /api/queues`.

This is the same product loop as other guided modules (`Understand → Extract → Store → Check missing → Act → Update state → Respond`). Only the workflow schema and tool allowlist change.

---

## Responsibility split

| Layer | Owns |
|---|---|
| **Gemma NLU** | Meaning of the turn: continue vs new task, `fields.name` / `description` / `members` |
| **LangGraph** | Workflow state, park/resume, slot lock, when to call tools |
| **Tools** | `list_agents`, `create_queue` (Express only) |
| **Express** | RBAC, validation, persist queue + members |
| **Postgres** | Source of truth for staff and teams |
| **React** | Teams page + guided preview from `ui_actions` |

Gemma does **not** write the database. User-facing chat text is phrased by the LLM (`phrase_reply`), not canned scripts.

---

## Chat steps

```text
User: create team
        → awaiting name

User: UMN team
        → store name → awaiting description

User: the UMN team is responsible for all the network related things
        → store description
        → LangGraph always calls list_agents (GET /api/agents)
        → roster saved in workflow memory
        → bot lists live staff, asks for a name or skip/none

User: mohamed   (or raghu, or raghu ram, or skip)
        → resolve against roster in memory
        → create_queue with canonical names
        → Teams list refreshes
```

There is **no** Private/Shared step. Type is always Shared.

Members are optional. `skip` / `none` creates the team with an empty member list.

An **explicit** new flow (`create ticket`, `create macro`, …) parks create-team and starts that flow. A first name like `mohamed` does **not**.

---

## Architecture (one turn)

```text
  user message
       │
       ▼
  restore team_draft
  (checkpoint + conversation_context + last staff bullets in history)
       │
       ▼
  Gemma NLU  ←  available_members + tool_memory + ~20 chat turns
       │
       ▼
  slot lock
  if awaiting name|description|create_members
     and utterance is not "create ticket" / other explicit create
     → CONTINUE_WORKFLOW (stay on Teams)
       │
       ▼
  Teams specialist
       │
       ├─ name / description → store field, ask next
       ├─ after description → list_agents → remember roster → list names
       └─ members → match roster → create_queue
       │
       ▼
  phrase_reply (module=team)  →  UI bubble + create_team ui_actions
```

If NLU mislabels a person as `START_CREATE_TICKET`, routing still stays on Teams unless the user actually said **create ticket**. The Tickets specialist will hand back to Teams while create-team is collecting.

---

## Workflow memory

Persisted on the LangGraph thread / `conversation_context` (not “the model’s brain” from the previous Gemma call).

| Key | What |
|---|---|
| `team_draft.awaiting` | `name` → `description` → `create_members` |
| `team_draft.name` / `description` | Filled fields (never re-asked) |
| `team_draft.available_members` | Display names from `list_agents` |
| `team_draft.tool_memory.list_agents` | Compact snapshot `{ names, count }` — not raw Express JSON |
| `workflow_data.*` | Same roster + fields, hydrated for NLU |

`list_agents` runs when description is complete (and again only if the roster is empty). It is **not** optional for Gemma to remember to call.

If the draft roster is missing on the next HTTP turn, the graph rebuilds it from:

1. `conversation_context.active_workflow`
2. Staff bullets in the last assistant message

---

## Name resolution (members step)

Meaning is Gemma’s: `CONTINUE_WORKFLOW` + `fields.members` = **canonical roster spelling**.

Code only keeps names that are on the in-memory list:

- Exact match, case-insensitive (`raghu ram` → `raghu ram`)
- Unique first token (`mohamed` → `Mohamed Fazil` if only one Mohamed)
- If two people share a first name → ask again with those names
- If NLU puts the person in `customerName` (ticket-shaped JSON) → same roster match

No nickname/regex dictionaries. Express `POST /api/queues` still matches members by the canonical full name from the API.

---

## Slot lock (why “customer’s full name” was wrong)

A short name was often classified as **create ticket**. Ticket phrasing asks for the **customer’s full name**.

While create-team is collecting:

- Foreign `START_*` / `NEW_TASK` become `CONTINUE_WORKFLOW` unless the utterance is an explicit create (`create ticket`, …)
- Active create-team is not overridden by a stale `ticket_draft`
- Orchestrator **pins** the Teams specialist
- Tickets agent **defers to Teams** if create-team is still awaiting members

---

## Tools and API

| Tool | When | Express |
|---|---|---|
| `list_agents` | After description (roster empty/stale) | `GET /api/agents` |
| `create_queue` | Name + description present; members resolved or skipped | `POST /api/queues` |

Teams tool allowlist: `list_queues`, `list_agents`, `create_queue`, `update_queue`, `delete_queue`.

RBAC: admin (and roles allowed to create queues). Agent/resolver/viewer cannot create teams in chat.

---

## UI

- Navigate to Teams (`agent-queues`)
- `create_team` actions: `step: name | description | members`, plus `name`, `description`, `members`, `availableMembers`
- Right panel: guided preview (step progress), not the full form, while chat is collecting
- On success: `done: true` and list refresh

Add-members on an **existing** team is a different workflow (`awaiting: members` / `members_names`), not create-team.

---

## Key code

| Concern | File |
|---|---|
| Orchestrator, slot lock, route pin | `ai-agents/app/agents/workflow_manager.py` |
| Teams specialist | `ai-agents/app/agents/teams.py` |
| Tickets defers while create-team is live | `ai-agents/app/agents/tickets.py` |
| Continue name/description/members, `list_agents`, `create_queue` | `ai-agents/app/tasks/catalog_commands.py` |
| NLU context (roster, tool_memory, history window) | `ai-agents/app/agents/workflow_nlu.py` |
| Roster match + unique first token | `ai-agents/app/workflow_schemas.py` (`resolve_roster_name`) |
| Hydrate draft + restore from context/history | `ai-agents/app/workflow_state.py` (`ensure_team_draft`) |
| Seed `team_draft` on each chat turn | `ai-agents/app/graph.py` |
| NLU / Teams phrasing rules | `ai-agents/app/prompts.py` |
| Tests | `ai-agents/tests/test_layer1_workflow_manager.py`, `ai-agents/tests/test_module_nav.py` |

---

## Acceptance

- After description, chat lists **live** agents from the DB, then asks for a name or skip.
- `mohamed` / `raghu` / `raghu ram` from that list create the team with the list spelling — **not** “customer’s full name”.
- `skip` creates the team without members.
- `create ticket` mid-flow parks the team (roster included) and starts create-ticket.
- Continue after a side quest does not re-ask name or description already in state.
