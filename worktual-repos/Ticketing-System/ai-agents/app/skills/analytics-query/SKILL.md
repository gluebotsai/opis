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
2. For how-many / count / CSAT / SLA % / volume asks, call `ask_semantic_layer` with the user's natural-language question (include time filters like "today" in the query string). Do not use `get_analytics` as a substitute for those NL metric asks.
3. If the user asks why / drivers / root cause while this Skill is selected, call `return_to_super` (`action=park`, `query`=user message) so Super can remount `analytics-root-cause` — do not invent a causal narrative from metric values alone. Runtime may also remount when `ask_ontology` is invoked.
4. Execute through MCP and consume the structured result.
5. Return a grounded natural response or typed refusal without exposing internal tool names, HTTP status codes, or service names.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Mutations execute at most once and are never automatically retried.
- Do not claim success unless the structured tool result reports success.
- Unsupported operations must return a typed capability refusal.

# Dependencies

None.

# Expected output

Return `executor-result-v1`: ask for a field, call an authorized tool, await confirmation, respond, request an allowed handoff, cancel, or refuse.
