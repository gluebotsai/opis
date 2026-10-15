---
name: macro-delete
description: Perform the macro delete capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "macro_crud_executor"
  task-ids: "macro.delete"
  schema-ref: "macro.delete"
  approval-policy: "interactive_high_risk"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: list_macros delete_macro
---

# Purpose

Perform `macro-delete` as a reusable declarative capability owned by `macro_crud_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. If `macro_id` is missing, call `list_macros` and resolve the row from TOOL RESULT. Never invent an id.
3. When you judge they already asked to delete that row (or they answered a summary ask), call `delete_macro` with `confirmed=true` **this turn**. Do not ask a second time.
4. If TOOL RESULT is `CONFIRMATION_REQUIRED` after you already judged consent, retry `delete_macro` with the same `macro_id` and `confirmed=true` in this turn.
5. If they refuse or change the target, do not pass `confirmed=true`.
6. Return a grounded natural response. Do not claim success without a successful tool result.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Mutations execute at most once and are never automatically retried.
- Do not claim success unless the structured tool result reports success.
- Unsupported operations must return a typed capability refusal.
- Never ask for confirmation twice after the user already affirmed.
- Never detect consent with keyword/regex lists; consent is LLM semantic intent only.

# Dependencies

None.

# Expected output

Return `executor-result-v1`: ask for a field, call an authorized tool, await confirmation, respond, request an allowed handoff, cancel, or refuse.
