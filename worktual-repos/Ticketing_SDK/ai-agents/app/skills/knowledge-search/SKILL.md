---
name: knowledge-search
description: Perform the knowledge search capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "intake_deflection_domain"
  executors: "ai_resolution_executor"
  task-ids: "knowledge.search"
  schema-ref: "knowledge.search"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: list_kb get_kb
---

# Purpose

Perform `knowledge-search` as a reusable declarative capability owned by `ai_resolution_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Call `list_kb` with the user's wording. Related articles are TOOL RESULT rows only.
3. If related rows exist: name those titles, call `get_kb` on the best ids from that TOOL RESULT, and walk those steps in plain sentences. If none apply, say so.
4. If the walk did not help or no article applied, ask whether they want a ticket filed and stay here. `return_to_super` with `action=park` and `query` = their utterance only after they asked or agreed to file (Domain pins ticket-create). Do not claim a ticket was filed.
5. Never invent article titles, ids, or product steps.
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
