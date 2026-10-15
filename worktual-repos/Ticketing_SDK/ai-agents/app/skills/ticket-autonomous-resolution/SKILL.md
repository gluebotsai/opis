---
name: ticket-autonomous-resolution
description: Perform the ticket autonomous resolution capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "resolution_lifecycle_domain"
  executors: "autonomous_resolution_executor"
  task-ids: "ticket.autonomous.resolution"
  schema-ref: "ticket.autonomous.resolution"
  approval-policy: "proactive_asga"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: get_ticket update_ticket
---

# Purpose

Perform `ticket-autonomous-resolution` as a reusable declarative capability owned by `autonomous_resolution_executor`.

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
4. Customer close/reopen: after the LLM judges intent, call `update_ticket` status only. Close → **Closed** (customer ack after staff **Resolved**) and queue Approvals. Reopen → **Reopened**. Do not classify close/reopen with word lists. Never set Resolved — staff own that status.
5. Execute that write through MCP to Express and consume the structured result.
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
