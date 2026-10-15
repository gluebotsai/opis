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
2. Collect or resolve only missing inputs without inventing business data (team name, description, members). Prefer working-memory `last_entity` / `team_draft` when the user says "here" / "this team" / "this form". A correction of a collected field is meaning of the whole utterance against this live draft — not keyword lists. Without a replacement, patch `awaiting` only (never store `null`). The next utterance is the replacement; if this utterance already includes it, patch that field and keep sibling values. Do not restart create.
3. When the next slot is members (name and description already on the live draft / last `patch_team_draft` TOOL RESULT): call `list_agents` **this turn**. The user-visible reply **must** list every name from that TOOL RESULT as HTML `<ul><li>` (email/role when present), then ask who to add. Runtime does not put that roster in chat. Do not ask who to add with an empty list. Do not recap or ask to create while `members` is still missing. Do not invent staff.
4. From this turn’s `list_agents` TOOL RESULT, decide who they meant (named people, or the whole offered roster). Call `patch_team_draft` with exact roster `members` and `awaiting=confirm` only when name and description are already on the live draft / last TOOL RESULT. If description is still missing, fix description first with their exact description-slot utterance — do not invent a shorter blurb and do not skip ahead. Prefer `member_ids` for `create_queue`.
5. `description` is whatever they gave for that slot. Copy it **verbatim** into `patch_team_draft`. Do not summarize, polish, or replace it with a one-line “handles X issues” sentence. If they mean to correct a collected field (for example the name) and did not give the replacement, `patch_team_draft` with `awaiting` only — do not store that instruction as `description`.
6. When name, description, and members are ready: ask for confirmation (or use the confirm chip). Recap as valid HTML so every field is easy to scan — never one run-on paragraph or "Name: … Description: … Members: a, b, c" on a few wrapped lines. Use `<p>` / `<br>` / `<ul><li>` only (never markdown `#` or `*`). One label, then the value. Put each member in its own `<li>`. Then one short question whether to create. Example shape:
   Name
   Campaign Team
   Description
   (their description, full text)
   Members
   Uday kumar G
   Ashika A
   (every selected name, one per line)
   Then: ask if that looks right and you should create the team.
   **Do not** call `create_queue` and **do not** claim the team was created or saved until after a successful `create_queue` TOOL RESULT this turn.
7. After you already recapped, if this utterance means they agree to create (conversation meaning, not a yes/confirm word list), call `create_queue` **this turn** with `confirmed=true` and name, description, and members from the live draft / last `list_agents` TOOL RESULT. If TOOL RESULT is `CONFIRMATION_REQUIRED`, retry with `confirmed=true` in this turn. Never invent a technical failure or send them to the Teams page instead of calling the tool.
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
