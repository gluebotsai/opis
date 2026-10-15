---
name: priority-delete
description: Perform the priority delete capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "priority_status_crud_executor"
  task-ids: "priority.delete"
  schema-ref: "priority.delete"
  approval-policy: "interactive_high_risk"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: list_priorities delete_priority
---

# Purpose

Perform `priority-delete` as a reusable declarative capability owned by `priority_status_crud_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. This turn call `list_priorities` first. Resolve **every** named row from that TOOL RESULT only. Never invent an id, never use Super/Domain numbers, never use sortOrder, never call `delete_priority` with empty args.
3. When they named more than one listed priority, delete **all** of those ids this turn in **one** `delete_priority` call. Pass `priority_ids` as a JSON array of those listed numeric ids and `confirmed=true` — never a string like `"[2937]"`. Do not tell them only one can be removed. Do not call `delete_priority` once per id. Do not ask them to pick one of the names they already gave.
4. When they named one row, call `delete_priority` once with `priority_id` set to that listed numeric id and `confirmed=true` this turn. Do not ask a second time.
5. If TOOL RESULT is `CONFIRMATION_REQUIRED` after you already judged consent, retry the **same** `delete_priority` arguments with `confirmed=true` in this turn. After the write runs, do not call it again.
6. If they refuse or change the target, do not pass `confirmed=true`.
7. Return a grounded natural response. Quote `payload.deleted` and `payload.failed` from the one TOOL RESULT. Do not claim a row was removed unless it appears in `deleted`.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Call `delete_priority` at most once this turn. Put every listed target id in that one call.
- Do not claim success unless the structured tool result reports success.
- Unsupported operations must return a typed capability refusal.
- Never ask for confirmation twice after the user already affirmed.
- Never detect consent with keyword/regex lists; consent is LLM semantic intent only.

# Dependencies

None.

# Expected output

Return `executor-result-v1`: ask for a field, call an authorized tool, await confirmation, respond, request an allowed handoff, cancel, or refuse.
