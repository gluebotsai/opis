---
name: team-members-update
description: Perform the team members update capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "team_queue_crud_executor"
  task-ids: "team.members.update"
  schema-ref: "add_team_members"
  approval-policy: "interactive_semantic"
  dependencies: ""
  local-controls: "patch_team_draft,navigate"
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: list_queues list_agents update_queue
---

# Purpose

Perform `team-members-update` as a reusable declarative capability owned by `team_queue_crud_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Identify the target team from working-memory `last_entity` (type team), `team_draft.id`/`name`, or `list_queues`. After a team was just created, “here” / “this team” / “one more member” means that team — do not re-ask which team when focus is present, and do not restart `team-create`.
3. **Read / list (do not refuse):** org staff → `list_agents`; team roster → `list_queues`. Answer from tool payloads only. If you will show names this turn, call `list_agents` in this turn (and `list_queues` for people already on the team). Never invent a roster.
4. Before asking who to add, call `list_agents` and **show eligible staff** from this turn’s tool result (org staff minus people already on the team).
5. When the user names who to add (by meaning against that roster):
   - Resolve to roster `member_ids` / display names.
   - Store them with `patch_team_draft` (include team `id`, pending members, awaiting confirm).
   - Recap the pending add and **ask for confirmation**.
   - **Do not** call `update_queue` yet.
   - **Do not** claim members were added or saved.
6. After pending members are on the draft:
   - If this turn means **apply those pending people** / update the team: call `update_queue` now with numeric `queue_id` for **this task’s team** from `team_draft.id` / the `list_queues` row that named that team (never the team label, never another team’s id from UI focus). **`members` set to those pending roster names only**, **`add_members: true`**, and `confirmed=true` when the write gate requires it. Do not send `member_ids` unless each id is the `list_agents` id for that same pending name. Do **not** call `list_agents` and re-ask who.
   - If they **name another eligible person**: append to pending with `patch_team_draft`, recap, wait — still no write.
   - If they want another person but did **not** name one: ask who; keep the pending names.
7. For **replace roster** only when the user explicitly wants a full replacement: omit `add_members` (or false) and pass the complete intended roster — still require confirmation before the write.
8. After `update_queue`, ground the reply **only** on the structured tool result (`success`, `members` / `memberDetails`). If tools were not called or the result is not success, say the change was not applied and ask to confirm or retry — never invent success.
9. Return a grounded natural response or typed refusal without exposing internal tool names.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Mutations execute at most once and are never automatically retried.
- Do not claim success unless the structured tool result reports success.
- Naming a person is **not** confirmation to write; confirmation is a separate semantic step (or confirm chip).
- Unsupported operations must return a typed capability refusal.

# Dependencies

None.

# Expected output

Return `executor-result-v1`: ask for a field, propose confirmation, call an authorized tool after confirm, respond from tool results, request an allowed handoff, cancel, or refuse.
