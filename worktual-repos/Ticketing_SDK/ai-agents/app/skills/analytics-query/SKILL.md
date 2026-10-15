---
name: analytics-query
description: Answer natural-language metric questions (how many, counts, CSAT, SLA %, volume, backlog) via ask_semantic_layer. Prefer over ticket list-search or get_metrics for those asks.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "analytics_audit_query_executor"
  task-ids: "analytics.query"
  schema-ref: "analytics.query"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: get_analytics ask_semantic_layer
---

# Purpose

Perform `analytics-query` as a reusable declarative capability owned by `analytics_audit_query_executor`.

# When to use

Activate for NL metric-value asks (how many open tickets, counts created today, CSAT, SLA %) whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. For how-many / count / CSAT / SLA % / volume asks, read **every** certified metric and dimension in this turn's ontology slice (id + purpose). Pick the closest purpose to this utterance — not the first row and not a generic volume id when a more specific metric exists. Then call `ask_semantic_layer`. Do not send natural-language query text to semantic. Do not use `get_analytics` as a substitute for those KPI asks.
   How to call `ask_semantic_layer`: required `metrics` = that best-fit id (or few). `group_by` / `filters` only if they asked to break down or constrain, using the matching slice dimension. "My team" is that filter, not a missing field — call `ask_semantic_layer` this turn. Do not ask which team and do not list teams. `order_by`, `time` only if they named a window (`period` or date-only `start`/`end`), `limit`, `dataScope`. Runtime fills organizationId, userId, product, agent.
3. If the user asks why / drivers / root cause while this Skill is selected, call `return_to_super` (`action=park`, `query`=user message) so Super can remount `analytics-root-cause` — do not invent a causal narrative from metric values alone. Runtime may also remount when `ask_knowledge_graph` is invoked.
4. Execute through MCP and consume the structured result.
5. Return a grounded HTML reply or typed refusal without exposing internal tool names, HTTP status codes, or service names. Never markdown (`#`, `**`, `*` bullets).

# Expected output

User-visible reply format (hard):
- One `<p>` intro (what the numbers are and the window).
- If TOOL RESULT has multiple rows (for example daily volume over 30 days), render an HTML list — one `<li>` per row: readable date, space, — or :, space, count. Example: `<p>Daily ticket volume for the last 30 days:</p><ul><li>August 24 — 17</li><li>August 25 — 19</li></ul>`
- Never smash fields together (`DateTickets`, `August2417`). Never a single run-on column.
- Quote only this turn’s TOOL RESULT. Empty rows → say no data exists.

Return `executor-result-v1`: ask for a field, call an authorized tool, await confirmation, respond, request an allowed handoff, cancel, or refuse.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Mutations execute at most once and are never automatically retried.
- Do not claim success unless the structured tool result reports success.
- Unsupported operations must return a typed capability refusal.

# Dependencies

None.
