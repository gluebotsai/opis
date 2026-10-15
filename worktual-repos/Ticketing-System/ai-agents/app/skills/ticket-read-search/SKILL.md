---
name: ticket-read-search
description: Browse, search, or open tickets by filters or id. Not for how-many/count/CSAT/SLA KPI questions — those use analytics-query + ask_semantic_layer.
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
allowed-tools: list_tickets portal_list_tickets get_ticket get_ticket_progress list_ticket_notes list_ticket_recommendations
---

# Purpose

Perform `ticket-read-search` as a reusable declarative capability owned by `ticket_lifecycle_executor`.

# When to use

Activate for browse/search/list/open-ticket asks whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

**Do not use** for how-many / count / backlog size / CSAT / SLA % — those require `ask_semantic_layer` on `analytics-query`. If pinned here for a metric ask, call `return_to_super` (`action=park`, `query`=user message) instead of `list_tickets`.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. If the user wants a KPI count (how many / CSAT / SLA %), call `return_to_super` to re-route — do not count via `list_tickets`.
3. Otherwise collect or resolve only missing list/get inputs without inventing business data.
4. Select the minimum authorized tool sequence needed for the task.
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
