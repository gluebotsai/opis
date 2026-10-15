---
name: priority-update
description: Perform the priority update capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "priority_status_crud_executor"
  task-ids: "priority.update"
  schema-ref: "priority.update"
  approval-policy: "interactive_semantic"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: list_priorities update_priority
---

# Purpose

Perform `priority-update` as a reusable declarative capability owned by `priority_status_crud_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

This Skill changes an **existing** priority. It is not for adding a new catalog row.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

Must resolve: existing `priority_id` (from list or prior focus). Then only the fields the user wants changed (`displayName` and/or `resolutionHours`).

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. If `priority_id` is missing: call `list_priorities` immediately. Match the user's label to an existing row, or ask which listed priority to change. Do **not** ask create-style "what resolution hours for this new name?" before an id exists.
3. After the target id is known, change only the field(s) they named. If they already said the old and new label, keep the listed `resolutionHours` — do not ask hours. Use the listed `id`, never `sortOrder`.
4. If the user wants a brand-new priority that does not exist in the list: `return_to_super` with action `park` (or cancel) and a query Domain can route to `priority-create`. Do not fake create under update tools.
5. When the change is known (rename and/or hours), call `update_priority` with `confirmed=true`. Do **not** ask keep-hours and then a second save confirm. If TOOL RESULT is `CONFIRMATION_REQUIRED`, retry **this turn** with the same arguments and `confirmed=true`.
6. If they refuse or change a field, do not pass `confirmed=true`.
7. Execute through MCP to Express and consume the structured result.
8. Return a grounded natural response or typed refusal without exposing internal tool names.

# Hard must-not

- Do **not** run create collect (new label → invent/suggest hours → create) under this Skill.
- Do **not** invent SLA hours for a label that has no resolved catalog id.
- Do **not** call `update_priority` without a resolved existing `priority_id` from `list_priorities` TOOL RESULT. Never invent ids or placeholders.
- Do **not** treat a bare short label alone as create; list first, then match or hand back for create.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Mutations execute at most once and are never automatically retried.
- Do not claim success unless **this turn's** structured tool result reports success. Never say a row was updated, created, or deleted when no write tool ran.
- Unsupported operations must return a typed capability refusal.
- Never ask for confirmation twice after the user already affirmed.
- Never treat a short new label + SLA hours as an update without a resolved catalog id from `list_priorities`.

# Dependencies

None.

# Expected output

Return `executor-result-v1`: ask for a field, call an authorized tool, await confirmation, respond, request an allowed handoff, cancel, or refuse.
