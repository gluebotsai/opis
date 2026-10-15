---
name: ticket-read-search
description: Browse, search, or open tickets by filters or id. Prefer ask_sql_layer when Context Layer SQL is available; otherwise list_tickets. Not for KPI counts — use analytics-query + ask_semantic_layer.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "resolution_lifecycle_domain"
  executors: "ticket_lifecycle_executor"
  task-ids: "ticket.read.search"
  schema-ref: "ticket.read.search"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: ask_sql_layer list_tickets portal_list_tickets get_ticket get_ticket_progress list_ticket_notes list_ticket_recommendations
---

# Purpose

Perform `ticket-read-search` as a reusable declarative capability owned by `ticket_lifecycle_executor`.

# When to use

Activate for browse/search/list/open-ticket asks whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

**Do not use** for how-many / count / backlog size / CSAT / SLA % — those require `ask_semantic_layer` on `analytics-query`. If pinned here for a metric ask, call `return_to_super` (`action=park`, `query`=user message).

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. If the user wants a KPI count (how many / CSAT / SLA %), call `return_to_super` to re-route — do not count via list tools.
3. Otherwise collect or resolve only missing list/get inputs without inventing business data.
4. **Support portal — their tickets / status (overrides staff SQL):** On the support portal, when the signed-in customer wants the status of their tickets or every ticket they created, this turn call **`portal_list_tickets`** (session is the customer). First page: no extra args — the tool returns **10** tickets. More of the same listing: call it again with `offset` and `limit` from `ticket_list_cursor` (next 10). Do **not** call `ask_sql_layer` or staff `list_tickets` for that — those tools are staff/org browse and must not be used to decide whether this customer has tickets. Ground the reply on that TOOL RESULT only. Speak only these TOOL RESULT fields: **id, subject, description, customerName, customerEmail, customerPhone, channel, status, updatedAt, createdAt**. Do not mention assignee, resolver, queue, priority, CSAT, skill, or aiSummary. Runtime table uses the same fields. Empty only when that TOOL RESULT is success and has no rows. Do not offer to file a new ticket for a status/list ask.
5. **List / search rows (staff / org browse only):** try `ask_sql_layer` first with an agent-authored `instruction` and `entityHint: wt:Ticket`. Pass `filters` for the constraint they asked (closed, open, assignee, queue, dates) and `limit` 12. A **successful** TOOL RESULT is the **page** — including `rows: []` / empty `data` / `status=not_applicable` meaning **zero** tickets. Runtime adds Express `totalRows` (full Postgres count for those filters, not capped at 12). Speak `totalRows` first, show this page, and if `hasMore` ask for the next 12. Never say 12 is the full set when `totalRows` is larger. Do **not** have the LLM call `list_tickets` after SQL success. Call `list_tickets` **this same turn** only when `ask_sql_layer` **fails** (`success` is false, transport/timeout/5xx, or no TOOL RESULT). Never treat empty rows as failure. If SQL returns FORBIDDEN with `kpi_not_allowed` in TOOL RESULT payload, call `return_to_super` to remount analytics.
   How to call `ask_sql_layer`: always pass `instruction` (one English sentence). Pass `entityHint` as `wt:Ticket`. Optional `filters` as `[{dimension, op, value|values}]` and integer `limit` (12 for a page). Never empty args. Runtime fills organizationId, userId, originProduct, originAgent. Ground the spoken reply on this turn’s TOOL RESULT `totalRows` plus rows.
   **Status / other filters (hard):** Apply only the filter they asked for. Catalog: **In Progress** is stored as **`In Progress`**. **`Open`** is a different status (new, not being worked). When they mean In Progress, `filters` must use `status` `In Progress` — never `open`, and never OR Open + In Progress + Reopened unless they asked for all unfinished tickets. On Express `list_tickets` fallback, pass `status=In Progress` the same way. Priority, assignee, queue, overdue: same rule — pass that filter, do not invent extras.
6. **Period lists on Express fallback:** when using `list_tickets`, pass `created_range` presets (`last_30d` for past month) or ISO dates from trusted `now_iso`.
7. **More of the same listing:** Judge this utterance against the last successful list in the conversation. Repeat **that** tool (`ask_sql_layer` if that is what returned the rows; `list_tickets` only if SQL had failed). Write the same period and filters into this turn’s `instruction` or args. Use `ticket_list_cursor` offset/limit as page context, not as a reason to switch tools or drop the date filter. Empty `list_tickets` args are wrong when they still want that filtered list. New search or period → `ask_sql_layer` from offset 0. One id → `get_ticket`. Meaning only — never a phrase table.
8. Reply with one short intro that states `totalRows`, then let runtime render the page. If `hasMore`, ask whether they want the next page. Do not write markdown/HTML tables. Empty TOOL RESULT → say no data exists for that customer or filter. Never narrate looking, searching, fetching, or asking them to try another spelling because a search was empty.
9. Return a grounded natural response or typed refusal without exposing internal tool names.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Do not claim success unless the structured tool result reports success.
- Unsupported operations must return a typed capability refusal.

# Dependencies

None.

# Expected output

Return `executor-result-v1`: ask for a field, call an authorized tool, await confirmation, respond, request an allowed handoff, cancel, or refuse.
