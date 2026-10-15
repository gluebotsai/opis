---
name: routing-optimize-workload
description: Perform the routing optimize workload capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "triage_routing_domain"
  executors: "workload_optimization_executor"
  task-ids: "routing.optimize.workload"
  schema-ref: "routing.optimize.workload"
  approval-policy: "proactive_asga"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: list_tickets list_agents list_queues get_metrics
---

# Purpose

Perform `routing-optimize-workload` as a reusable declarative capability owned by `workload_optimization_executor` (WLOA).

On `schedule.wloa`, inspect open load and persist a short load brief (notes, overloaded names, lighter names) for ITRA. **Do not assign** L1/L2. Domain does not run this Skill on lean `ticket.created`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Collect or resolve only missing inputs without inventing business data.
3. Select the minimum authorized tool sequence needed for the task.
4. Obtain and validate approval evidence when policy requires it.
5. Persist the load brief for ITRA. Do not mutate tickets.
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
