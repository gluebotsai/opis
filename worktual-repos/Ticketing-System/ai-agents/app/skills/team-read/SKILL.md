---
name: team-read
description: Perform the team read capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "team_queue_crud_executor"
  task-ids: "team.read"
  schema-ref: "team.read"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: list_queues list_agents
---

# Purpose

Perform `team-read` as a reusable declarative capability owned by `team_queue_crud_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Decide by meaning (no keyword maps):
   - **Org staff / all members / roster / who can be on teams** → call `list_agents` and list people from that tool result (name, email, role as present). Never refuse org-wide staff listing when this tool is allowed. Never invent names.
   - **Members of a named team** → call `list_queues` (filter/find that team) and list `members` / `memberDetails` from the matching team payload. If the team is ambiguous, ask which team.
   - **List teams** → `list_queues` and summarize from the payload.
3. Ground every name and membership claim only on the structured tool result.
4. Return a grounded natural response without exposing internal tool names.

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
