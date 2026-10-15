---
name: analytics-generate-insights
description: Chat insights and combined value+why analytics. Use ask_semantic_layer for metric numbers; ask_ontology for drivers. Not a substitute for ticket browse/search.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "resolution_lifecycle_domain"
  executors: "insights_analytics_executor"
  task-ids: "analytics.generate.insights"
  schema-ref: "analytics.generate.insights"
  approval-policy: "proactive_asga"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: ask_semantic_layer ask_ontology get_analytics get_metrics list_tickets get_csat_reports
---

# Purpose

Perform `analytics-generate-insights` as a reusable declarative capability owned by `insights_analytics_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Collect or resolve only missing inputs without inventing business data.
3. For how-many / counts / CSAT / SLA %, call `ask_semantic_layer` first. For why/drivers, call `ask_ontology`. Combined asks: semantic then ontology. Do not invent counts from `list_tickets`.
4. Obtain and validate approval evidence when policy requires it.
5. Execute business operations through MCP to Express and consume the structured result.
6. Return a grounded natural response or typed refusal without exposing internal tool names.

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
