---
name: priority-create
description: Perform the priority create capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "priority_status_crud_executor"
  task-ids: "priority.create"
  schema-ref: "create_priority"
  approval-policy: "interactive_semantic"
  dependencies: ""
  local-controls: "patch_priority_draft,navigate"
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: create_priority
---

# Purpose

Perform `priority-create` as a reusable declarative capability owned by `priority_status_crud_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

Required create fields: short `displayName` (catalog label) then `resolutionHours` (SLA). A create-intent sentence is not a display name.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. If the user only asked to create/set a priority (no short label yet), ask for the **priority display name** first — do not store the full request as `displayName`, and do not claim the name was noted.
3. After a real short label (e.g. Critical, P1): call `patch_priority_draft` with `displayName`, then ask for resolution hours. Never invent hours and never skip the patch. A correction of a collected field is meaning of the whole utterance against this live draft — not keyword lists. Without a replacement, patch `awaiting` only. The next utterance is the replacement; if this utterance already includes it, patch that field and keep sibling values. Never store `null` or the instruction sentence. Do not restart create.
4. If they ask you to suggest hours: offer a few common SLA choices (e.g. 2 / 4 / 8) as options and wait for their pick — do not write hours into the draft or claim a value until they choose a number.
5. When they give hours: `patch_priority_draft` with **`resolutionHours` only**, then recap **this draft’s** label + hours and ask whether to create this priority. Never recap a team or other Skill. Do **not** call `create_priority` on that same field-collect turn, and do **not** pass `confirmed=true` yet.
6. On the **next** turn, when you judge they consented to that summary, call `create_priority` with the collected fields and `confirmed=true` once — that write should succeed (do not expect a second affirm after a chat summary already asked).
7. Execute through MCP to Express and consume the structured result.
8. Return a grounded natural response confirming the created priority (name + hours). Never reply with an idle greeting after a successful create.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Mutations execute at most once and are never automatically retried.
- Do not claim success unless the structured tool result reports success.
- Unsupported operations must return a typed capability refusal.
- Never treat "create/set/add priority…" intent text as the priority label.
- Never skip the summary-confirm step after hours are collected.
- Never invent authoritative SLA hours; only store the number the user chose.
- Always `patch_priority_draft` when binding label or hours so TaskState/draft stay aligned.

# Dependencies

None.

# Expected output

Return `executor-result-v1`: ask for a field, call an authorized tool, await confirmation, respond, request an allowed handoff, cancel, or refuse.
