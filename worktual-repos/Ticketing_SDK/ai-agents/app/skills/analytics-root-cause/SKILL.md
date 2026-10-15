---
name: analytics-root-cause
description: Answer why/drivers/root-cause analytics via ask_knowledge_graph. For value+why, call ask_semantic_layer then ask_knowledge_graph. Not for ticket browse/search or dashboard snapshots alone.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "analytics_audit_query_executor"
  task-ids: "analytics.root.cause"
  schema-ref: "analytics.root.cause"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: ask_semantic_layer ask_knowledge_graph
---

# Purpose

Perform `analytics-root-cause` as a reusable declarative capability owned by `analytics_audit_query_executor`.

# When to use

Activate for why / drivers / root-cause / “what is causing…” asks whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. For why/drivers/root-cause narrative, call `ask_knowledge_graph` with the user's question.
3. If the ask also needs an exact KPI number (how many + why), read **every** certified metric and dimension in this turn's ontology slice (id + purpose), pick the closest purpose, call `ask_semantic_layer` with that `metrics: [...]` first, then `ask_knowledge_graph`. Do not invent counts from ticket lists.
   How to call `ask_semantic_layer`: required `metrics` = the best-fit slice id(s). `group_by` / `filters` only for a requested break-down or named constraint. `time` only if they named a window. Runtime fills organizationId, userId, product, agent.
4. Execute through MCP and consume the structured result.
5. Return a grounded natural response or typed refusal without exposing internal tool names. Plain text only — no `#` or `*` markdown in the reply.

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
