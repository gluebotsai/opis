---
name: team-create
description: Perform the team create capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "team_queue_crud_executor"
  task-ids: "team.create"
  schema-ref: "create_team"
  approval-policy: "interactive_semantic"
  dependencies: ""
  local-controls: "patch_team_draft,navigate"
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: list_agents create_queue
---

# Purpose

Perform `team-create` as a reusable declarative capability owned by `team_queue_crud_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Collect or resolve only missing inputs without inventing business data (team name, description, members). Prefer working-memory `last_entity` / `team_draft` when the user says "here" / "this team" / "this form".
3. Early in the flow (before or when asking who should be on the team), call `list_agents` and **present the roster to the user** (names, and email/role when present) so they can pick members. Do not invent staff.
4. From the structured roster result, identify the staff the user named (by meaning — name or email). Prefer `member_ids` for `create_queue`.
5. Keep `description` as the user's team description only; do not paste articles, URLs, or tool prose into it.
6. When name, description, and members are ready: ask for confirmation (or use the confirm chip). **Do not** call `create_queue` and **do not** claim the team was created until after confirmation.
7. After semantic confirm, execute `create_queue` through MCP to Express (with `confirmed=true` when the write gate requires it) and consume the structured result.
8. On validation failure, explain the grounded tool message and ask only for what is still missing — do not claim the team was created.
9. Ground success only on a successful `create_queue` tool result in this turn.

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
