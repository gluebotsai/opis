---
name: status-update
description: Perform the status update capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "priority_status_crud_executor"
  task-ids: "status.update"
  schema-ref: "status.update"
  approval-policy: "interactive_semantic"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: list_statuses update_status
---

# Purpose

Perform `status-update` as a reusable declarative capability owned by `priority_status_crud_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

This Skill changes an **existing** status. It is not for adding a new catalog row.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

Must resolve: existing `status_id` (from list or prior focus). Then only the fields the user wants changed.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. If `status_id` is missing: call `list_statuses` immediately. Match the user's label to an existing row, or ask which listed status to change. Do **not** run create collect under this Skill.
3. After the target id is known, ask which field(s) to change if unclear.
4. If the user wants a brand-new status that does not exist in the list: `return_to_super` with action `park` (or cancel) and a query Domain can route to `status-create`. Do not fake create under update tools.
5. When the change is known, call `update_status` with `confirmed=true`. If TOOL RESULT is `CONFIRMATION_REQUIRED`, retry **this turn** with the same arguments and `confirmed=true` — do not ask a second time.
6. If they refuse or change a field, do not pass `confirmed=true`.
7. Execute through MCP to Express and consume the structured result.
8. Return a grounded natural response or typed refusal without exposing internal tool names.

# Hard must-not

- Do **not** run create collect (new label → confirm create) under this Skill.
- Do **not** call `update_status` without a resolved existing `status_id` from `list_statuses` TOOL RESULT. Never invent ids or placeholders.
- Do **not** treat a bare short label alone as create; list first, then match or hand back for create.
- Do **not** tell the user the status was updated unless `update_status` returned success this turn.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Mutations execute at most once and are never automatically retried.
- Do not claim success unless **this turn's** structured tool result reports success. Never say a row was updated, created, or deleted when no write tool ran.
- Unsupported operations must return a typed capability refusal.
- Never ask for confirmation twice after the user already affirmed.
- Never treat a short new label as an update without a resolved catalog id from `list_statuses`.

# Dependencies

None.

# Expected output

Return `executor-result-v1`: ask for a field, call an authorized tool, await confirmation, respond, request an allowed handoff, cancel, or refuse.
