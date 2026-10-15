# AI chat coworker — A to Z

This is the **staff / portal chat MAS** as it runs today: Super → Domain → Executor. It is **not** a LangGraph specialist graph and **not** the background proactive agents (TCAA, ITRA, ASGA, …).

Companion docs:

- [ticketing-agents-hierarchy-and-context-layer.md](./ticketing-agents-hierarchy-and-context-layer.md) — all 31 harness ids
- [agents-working-guide.md](./agents-working-guide.md) — proactive family
- Frozen chat rules: `.cursor/rules/three-layer-mas-architecture.mdc`

Older [agents.md](./agents.md) still describes a LangGraph graph as the meaning engine. **That is not how staff coworker chat routes today.**

---

## A. What this system is

Staff types in coworker chat. One utterance is **intent**. The LLM (plus LLM tool calls) owns meaning. Code after the LLM owns schemas, RBAC, tenant, and writes.

```text
User utterance
  → React  POST /api/coworker/agent-turn
  → Express (JWT, RBAC, hydrate context, MCP token)
  → ai-agents  ticketing_coworker
  → Super LLM  (one Super tool)
  → Domain LLM (one delegate)
  → Executor LLM + Skill + MCP tools
  → Express → Postgres  (or Context Layer for certified numbers / SQL rows)
  → TOOL RESULT
  → Executor grounded reply
  → React paints prose + ui_actions
```

**Postgres is the source of truth for existing business rows.** Context Layer (ontology / semantic / SQL) is the certified analytics and warehouse-list path. Agents never invent ticket ids, metric ids, or list rows.

---

## B. Entry and envelope

| Piece | Role |
|-------|------|
| **React** (`ui-frontend`) | Chat UI, drafts, `ui_actions` (navigate, tables, forms) |
| **Express** (`ui-backend`) | Cookie JWT, RBAC, `coworkerAgentTurn.ts`, mint MCP JWT |
| **ai-agents** (FastAPI) | Three-layer turn, tool loop, phrasing |
| **MCP** (`mcp-server`) | Tool catalog the Executor may call |
| **Express APIs** | All mutations and most lists |
| **Context Layer** | `CONTEXT_LAYER_URL` — slice, semantic KPIs, SQL ticket rows |
| **Postgres** | Business data |

Typical turn body: message, session id, page/module, history, focused entity, drafts, optional confirm chip.

Env that must be set for analytics/SQL: `CONTEXT_LAYER_URL` (and timeout/product). If it is missing, semantic/SQL return `CONFIG` and the model must not invent a number.

---

## C. Three layers (frozen)

| Layer | Agent | Owns | Must not |
|-------|--------|------|----------|
| **Super** | `ticketing_super_agent` | CONTINUE / NEW_TASK / SIDE_QUEST / CANCEL / RESUME. Tools: `route_to_domain`, `continue_active_task`, `resume_task`, `refuse_capability` | Collect slots, confirm writes, pick metric ids, call slice / semantic / SQL, list tickets |
| **Domain** (5) | intake, triage, resolution, knowledge, catalog | One bounded plan: `delegate_to_executor` (Executor + Skill + objective) | Collect fields, call MCP writes, pick metric ids |
| **Executor** (25) | e.g. `ticket_lifecycle_executor`, `analytics_audit_query_executor` | Skill, `agent.md`, MCP tools, collect, confirm, grounded reply | Invent TOOL RESULT, skip Express RBAC |

Prompt source of truth for each agent: `ai-agents/app/agents/definitions/<id>/agent.md`.  
Skill procedures: `ai-agents/app/skills/<skill>/SKILL.md`.

Runtime also injects a **Context Layer call block** (`context_layer_call_prompt_block` in `ai-agents/app/prompts/builder.py`) so each layer knows what it may call.

---

## D. Super — first hop every turn

Source: `ai-agents/app/agents/definitions/ticketing_super_agent/agent.md`.

**Job:** Judge the **whole utterance + conversation**. Call **exactly one** Super tool, or greet in prose if there is no work.

| Tool | When |
|------|------|
| `continue_active_task` | Live pin and they are still on that Skill (field, confirm, more of the **same** list) |
| `route_to_domain` | New or different Skill; park first if needed. `query` carries their words + focused id |
| `resume_task` | Unpark without re-asking filled slots |
| `refuse_capability` | Forbidden CRUD or other product |

**Domain ownership Super is taught (do not keyword-map this in code):**

| Domain | Owns | Does not own |
|--------|------|----------------|
| `intake_deflection_domain` | New problem / how-to / file a **new** ticket | Existing ticket status/list, catalog admin, how-many |
| `resolution_lifecycle_domain` | Existing tickets: list, open, note, reassign, escalate, close, reopen | New filing, KPI counts |
| `catalog_administration_domain` | Customers lookup, teams, KB write, macros, priorities, **how-many / CSAT / SLA %** | File a ticket, walk a how-to |
| `knowledge_domain` | Suggest articles for a ticket in play | Write/publish KB (catalog) |
| `triage_routing_domain` | Classify, prioritize, who should own, load | “File a ticket” |

**Super Context Layer instruction:** runtime already POSTs `/v1/ontology/slice` for Super. Super **must not** call slice, `ask_semantic_layer`, or `ask_sql_layer`. For how-many it copies **what they want counted**, break-down, filters, and window into `query`. It does **not** pick metric or dimension ids.

---

## E. Domain — one delegate

Each Domain `agent.md` says: judge meaning; **never** keyword maps; call **exactly one** `delegate_to_executor`; Executor + Skill + task from the same Eligible JSON row; put their words in `objective`; **do not pick metric ids**.

Example — catalog Domain for numbers:

- Executor: `analytics_audit_query_executor`
- Skill: `analytics-query` (values) or `analytics-root-cause` (why)
- Objective: repeat measure, break-down, filters, window in English

Ticket **rows** (“show tickets I created”) go to `ticket_lifecycle_executor` / `ticket-read-search`, not analytics.

---

## F. Executor — tools and reply

1. Load the Skill (`allowed-tools`, procedure).
2. Runtime injects **this Executor’s** ontology slice (certified metrics + dimensions).
3. Collect missing schema fields via `patch_*_draft` (one field per turn unless the Skill says otherwise).
4. Call MCP tools. Writes need semantic confirm + `confirmed=true` when the tool requires it.
5. Reply **only** from this turn’s TOOL RESULT. No invented ids, counts, or “saved” without a successful write.

Executors that matter for **metrics vs lists**:

| Executor | Skill | Tool | Use |
|----------|-------|------|-----|
| `analytics_audit_query_executor` | `analytics-query` | `ask_semantic_layer` | How many, CSAT, SLA %, volume |
| `analytics_audit_query_executor` | `analytics-root-cause` | `ask_knowledge_graph` | Why / drivers |
| `insights_analytics_executor` | (insights) | `ask_semantic_layer` | Same semantic contract |
| `ticket_lifecycle_executor` | `ticket-read-search` | `ask_sql_layer` then `list_tickets` only if SQL **fails** | Ticket **rows** |

Allowlists: `SEMANTIC_REPORTING_AGENTS` and `SQL_LIST_AGENTS` in `ai-agents/app/tools/registry.py`.

---

## G. Memory (four layers)

| Layer | What |
|-------|------|
| **Working** | TaskState / live draft (`ticket_draft`, `kb_draft`, list cursors) |
| **Short-term** | Recent turns + optional summary |
| **Long-term** | Authenticated memory search (not a dump of the DB) |
| **Preferences** | Soft → prompt; hard → verification tools |

List paging: persist `ticket_list_cursor` / `customer_list_cursor` (offset, page size, `hasMore`, filters). Super **continues** the same list Skill; Executor calls the same list tool with the cursor. **No** phrase table for “show more”.

Default chat page size for ticket lists is **12** (`limit` default 12). That is a page, not “only 12 tickets exist.”

---

## H. Decision boundary (every module)

```text
LLM understands
  → Super routes or continues
  → Domain delegates
  → Executor asks or calls a tool
  → Code validates (schema / RBAC / tenant / confirm gate)
  → Express or Context Layer
  → Postgres or warehouse
  → TOOL RESULT
  → Executor phrases
```

**Do:** field schemas on Executor Skill + `patch_*_draft`; park on a different Skill; resolve existing ids from list/get TOOL RESULT.

**Don’t:** keyword routers; LLM mutate DB; skip Express RBAC; invent entity data; fold SLA/mail/proactive into this chat MAS.

---

## I. Context Layer — three HTTP APIs

Base URL: `CONTEXT_LAYER_URL` (example `http://192.168.11.25:8765`). Live logs: `CONTEXT LAYER` blocks in `ai-agents/logs/agent-turn-YYYY-MM-DD.log`.

### 1. Ontology slice — `POST /v1/ontology/slice`

**Who calls it:** runtime, for Super, Domain, and Executor (cached per org / user / agent). Agents do **not** call this as an MCP tool.

**Payload (runtime):**

```json
{
  "organizationId": 1003,
  "userId": 1008,
  "product": "ticketing",
  "agent": "analytics_audit_query_executor",
  "format": "prompt"
}
```

**What it is for:** certified **metric ids** and **dimension ids** plus purpose text, injected into the Executor prompt. The LLM must pick ids from **this turn’s slice**, never invent `open_ticket_count` or reuse last turn’s leftover.

### 2. Semantic query — `POST /v1/semantic/query`

**Who calls it:** reporting Executors via MCP `ask_semantic_layer` only.

**What the LLM passes (tool args):** `metrics` (required), optional `group_by`, `filters`, `time`, `order_by`, `limit`, `dataScope`. **Never** `organizationId`, `userId`, `product`, `agent`, and **never** the raw user sentence as `query`.

**What runtime sends:**

```json
{
  "organizationId": 1003,
  "userId": 1008,
  "product": "ticketing",
  "agent": "analytics_audit_query_executor",
  "metrics": ["open_tickets_metric"],
  "group_by": ["queue_name"],
  "filters": [{ "dimension": "priority", "op": "in", "values": ["high"] }],
  "time": { "period": "last_7_days", "grain": "day" },
  "order_by": ["open_tickets_metric"],
  "limit": 20,
  "dataScope": "org"
}
```

Only include optional keys when the user asked for them. Extra `groupBy` / `orderBy` camelCase keys are rejected (422).

If semantic returns **503**, runtime may POST `/v1/sql/query` as a **metric fallback** with a composed English `instruction` (not a second LLM SQL list).

### 3. SQL query — `POST /v1/sql/query`

**Who calls it:** ticket-list Executors via `ask_sql_layer` (rows), or the 503 fallback above.

**HTTP body is only:**

```json
{
  "organizationId": 1003,
  "userId": 1008,
  "originProduct": "ticketing",
  "originAgent": "ticket_lifecycle_executor",
  "instruction": "List tickets created by the current user, sorted by latest first. Entity dimension: wt:Ticket. Limit: 12 rows."
}
```

The LLM still passes `instruction`, `entityHint`, optional `filters`, `limit` on the **tool**. Runtime **folds** those into the single `instruction` string for Context Layer.

`list_tickets` (Express) runs **only** when `ask_sql_layer` **fails** (transport, 5xx, `success: false`). Empty `rows: []` is success = **zero** matching tickets, not a reason to call Express.

---

## J. How the agent is instructed to pick metrics and filters

These instructions are standing prompt + Skill, not regex on the sentence.

### Super (metrics)

- How-many / CSAT / SLA % → `route_to_domain` **catalog**.
- Put in `query`: what to count, any break-down, filters, time window.
- Do **not** choose `open_tickets_metric` vs `ticket_volume`.

### Domain (metrics)

- Delegate `analytics_audit_query_executor` + `analytics-query`.
- Repeat measure / break-down / filters / window in `objective`.
- Do **not** choose metric or dimension ids.

### Analytics Executor (`analytics_audit_query_executor` + `analytics-query`)

From `agent.md` and the Context Layer block:

1. Read **every** certified metric and dimension in **this turn’s** slice (id + purpose).
2. Compare the **whole utterance** to every row.
3. Pick the metric whose **purpose** is the closest match — not the first row, not last turn’s id, not generic volume when a more specific id exists (open vs created vs backlog vs CSAT vs SLA vs mine).
4. If two are close, take the more specific purpose. If none fit, ask one clarifying question or `return_to_super` — do not guess a weak metric.
5. Call `ask_semantic_layer` with that id in `metrics` (example `["open_tickets_metric"]`).
6. **`group_by`:** only if they asked to break down (team, queue, agent, status, priority, channel). Use the dimension whose purpose matches. Omit for a single headline number.
7. **`filters`:** optional `[{dimension, op, value}]` or `{dimension, op, values}`. `op` is `eq` or `in`. Never a JSON string and never `{due: overdue}`.
8. **`time`:** only when they **named** a window. Either `{period}` (`last_7_days`, `last_30_days`, `today`, `this_week`, `this_month`, `this_quarter`, `previous_quarter`, `this_year`, `previous_year`, `overall`) **or** `{start, end}` as `YYYY-MM-DD` with optional `grain`. Never both. Never invent `last_7_days` / `last_7d`.
9. **`order_by`:** optional sort keys from the slice.
10. **`limit`:** 1–500. **`dataScope`:** `org` or `mine` when they mean org-wide vs personal.
11. Phrase **numbers only** from TOOL RESULT. Why/drivers → `ask_knowledge_graph`, not invented commentary.

Do **not** use `get_metrics` / `get_analytics` for natural-language how-many (those are Home snapshot / charts).

### Ticket-list Executor (`ticket-read-search`)

- “Show tickets I created” is **rows**, not a KPI.
- `ask_sql_layer`: one English `instruction` (who, status, window, sort). `entityHint=wt:Ticket`. Optional filters from the slice (`status`, `priority`, `queue_name`, `is_overdue`). `limit` default **12** for chat pages.
- In Progress → filter status **Pending**, not Open.
- Ground the table on this turn’s SQL (or Express) rows only.
- Next page: same tool, cursor offset, same filters. Super `continue_active_task`.

---

## K. Worked examples

### “How many open tickets?”

1. Super → catalog Domain (`query` ≈ count open tickets).
2. Domain → `analytics_audit_query_executor` / `analytics-query`.
3. Slice inject → Executor picks e.g. `open_tickets_metric` (purpose = currently open), **no** `group_by`.
4. `POST /v1/semantic/query` with `metrics: ["open_tickets_metric"]`.
5. Reply quotes TOOL RESULT only.

### “Which queue has more tickets this month?”

1. Same route to analytics.
2. Metric whose purpose is volume/created (not “open” unless they said open).
3. `group_by: ["queue_name"]`, `time: {period: "this_month"}` if they named this month.
4. Do not invent `orderBy` camelCase.

### “Show the tickets created by me”

1. Super → **resolution** Domain (existing tickets list), not catalog.
2. Domain → `ticket_lifecycle_executor` / `ticket-read-search`.
3. `ask_sql_layer` instruction ≈ list tickets created by current user, latest first; `limit` 12.
4. Runtime SQL body: five fields; instruction includes entity + limit.
5. Table from `rows`. More tickets → another SQL call with offset 12, not a bigger invented list.

---

## L. Guided create / writes (chat)

Same three layers. Executor collects via `patch_*_draft`. Confirm is **semantic** (history + this turn), not a yes-word list.

- Existing-row writes need a numeric id from list/get/focus this session.
- `publication_intent` `draft` | `publish` (LLM tool arg) → `draft_kb_article` or `create_kb_article` when title/category/body are complete.
- Never claim saved from a patch TOOL RESULT.

---

## M. Hard rules (query path)

- No regex / keyword tables to classify intent, Skill, slots, confirm, or “show more”.
- No invented entity ids, names, or KPI numbers.
- No static canned chat bubbles; LLM writes user-visible prose (HTML in some Skills).
- User-visible replies: no `#` headings and no `*` markdown for bold/bullets unless a Skill explicitly uses HTML.
- Proactive mail/SLA agents stay **out** of this chat loop unless a task says otherwise.

Allowed after the LLM: schema types, RBAC, tenant, payload limits, confirm gates.

---

## N. What you see in the live log

File: `ai-agents/logs/agent-turn-YYYY-MM-DD.log` (also stdout).

- `ROUTE Super → Domain` / `Domain → Executor`
- `LLM` hops (tools vs reply)
- `CONTEXT LAYER` `ontology_slice` | `semantic_query` | `sql_query` — **payload + response**
- `TOOL` MCP name, args, TOOL RESULT
- `FINAL RESPONSE`

Two extra LLM **replies** after one SQL call are often the confirm-retry (first reply discarded) if a draft is still “choice pending” in session — not a second SQL request.

---

## O. Source map

| Concern | Path |
|---------|------|
| Super / Domain / Executor prompts | `ai-agents/app/agents/definitions/*/agent.md` |
| Skills | `ai-agents/app/skills/*/SKILL.md` |
| Chat host | `ai-agents/app/agents/ticketing_coworker.py` |
| Tool loop | `ai-agents/app/runtime/tool_loop.py` |
| CL prompt blocks | `ai-agents/app/prompts/builder.py` → `context_layer_call_prompt_block` |
| Slice / semantic / SQL HTTP | `ai-agents/app/tools/catalog_tools.py` |
| Tool allowlists | `ai-agents/app/tools/registry.py` |
| MCP catalog | `shared/ticketing_tool_catalog.json` |
| Express turn | `ui-backend/src/server/ai/coworkerAgentTurn.ts` |
| Turn log | `ai-agents/app/observability/turn_log.py` |

---

## P. Not this document

- **Proactive** agents (events, Approvals, ASGA) — see [agents-working-guide.md](./agents-working-guide.md)
- **Portal widget** capture vs staff chat (same Super entry when used; different surface/RBAC)
