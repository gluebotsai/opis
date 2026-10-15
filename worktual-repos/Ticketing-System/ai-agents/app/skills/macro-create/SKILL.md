---
name: macro-create
description: Perform the macro create capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "macro_crud_executor"
  task-ids: "macro.create"
  schema-ref: "create_macro"
  approval-policy: "interactive_semantic"
  dependencies: ""
  local-controls: "patch_macro_draft,navigate"
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: create_macro
---

# Purpose

Perform `macro-create` as a reusable declarative capability owned by `macro_crud_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Collect title, then body. If this turn only started create-macro, ask for the title — do **not** patch the start phrase into `title` or `body`.
3. After both fields exist: summarize title + body and ask to save. Do not call `create_macro` on the same turn the body was first saved.
4. On a later turn, when you judge they consented, call `create_macro` with `confirmed=true` and the draft fields. If TOOL RESULT is `CONFIRMATION_REQUIRED`, call again in the **same turn** with `confirmed=true` — do not re-ask.
5. Return a grounded natural response or typed refusal without exposing internal tool names.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Mutations execute at most once and are never automatically retried.
- Do not claim success unless the structured tool result reports success.
- Unsupported operations must return a typed capability refusal.
- Never treat the start-create utterance as the macro title.

# Dependencies

None.

# Expected output

Return `executor-result-v1`: ask for a field, call an authorized tool, await confirmation, respond, request an allowed handoff, cancel, or refuse.
